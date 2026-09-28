import type {
  ProjectLifecycleCommand,
  ProjectReadinessCallerResponse,
  ProjectReadinessConditionResponse,
  ProjectReadinessResponse,
  ReadinessConditionSeverity,
} from '@erp/types';

/**
 * ADR-019 CONST-PLC-005 — the project readiness policy is FIXED domain code, not a configurable
 * engine. It answers "what must be true to run this lifecycle command?" branched on
 * `commercialModel`, and returns structured conditions (code + severity + satisfied) so the read
 * contract (CONST-PLC-009) can explain *why* a project is not ready, and Phase B can later waive a
 * SPECIFIC failed condition (CONST-PLC-006) rather than the whole transition.
 *
 * This module is pure (no Prisma, no I/O): the service loads a `ReadinessSnapshot` of already-known
 * domain facts and hands it here. That keeps the branching logic unit-testable in isolation.
 */

/** The already-loaded domain facts the policy reads. Loading them is the repository's job. */
export interface ReadinessSnapshot {
  status: string;
  commercialModel: string; // 'CLIENT_CONTRACT' | 'INTERNAL_CAPITAL'
  startDate: Date | null;
  expectedEndDate: Date | null;
  clientId: string | null;
  clientStatus: string | null; // Client.status, or null when no client is assigned
  activeContract: { status: string; startDate: Date | null } | null; // effective client contract
  hasBaselinedBoq: boolean;
  activeMemberCount: number; // active members incl. the auto-enrolled project manager
  /**
   * When each fact became true, from sources the repository trusts (ADR-019 amendment 2026-09-28).
   * Optional: without it every `satisfiedAt` is null — the policy never invents a time.
   */
  evidence?: ReadinessEvidence;
}

/**
 * The timestamps behind `satisfiedAt`. Each is null when no trustworthy source exists; see
 * `docs/design/project-overview-implementation.md` §6.2 for the source of each.
 */
export interface ReadinessEvidence {
  /** Earliest `baselinedAt` among the BOQ versions that are currently committed/baselined. */
  boqCommittedAt: Date | null;
  /** The effective contract's latest `record-signed` / `activate` audit event. */
  contractActivatedAt: Date | null;
  /** The effective contract's `record-signed` audit event (that command always sets the date). */
  contractStartDateSetAt: Date | null;
  /** Every membership row of the project, removed ones included. */
  memberships: ReadonlyArray<{ joinedAt: Date; removedAt: Date | null }>;
}

/**
 * Genuine server-side data dependencies between Start conditions: the key cannot be satisfied
 * until every listed code is. Only a dependency the data itself imposes belongs here.
 *
 * - CONTRACT_START_DATE is read off the effective main contract, and the one command that records
 *   that contract (`record-signed`) writes the start date with it.
 *
 * Deliberately absent: BOQ_BASELINED -> ACTIVE_MAIN_CONTRACT. Since ADR-032 `recordSigned` needs a
 * live BOQ whose operational version passes BOQ readiness, not a committed one. And CLIENT_ACTIVE ->
 * ACTIVE_MAIN_CONTRACT: `recordSigned` takes the client in its own body.
 */
export const READINESS_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  CONTRACT_START_DATE: ['ACTIVE_MAIN_CONTRACT'],
};

const TARGET_STATUS: Record<ProjectLifecycleCommand, string> = {
  start: 'ACTIVE',
  'practical-completion': 'PRACTICAL_COMPLETION',
  closeout: 'CLOSEOUT',
  close: 'CLOSED',
  cancel: 'CANCELLED',
};

// Conditions the ADR names for a command whose source domain is not yet queryable from the
// project. Surfaced as `deferred` so the contract is honest instead of faking a satisfied check.
// (start's deferred set is computed — INTERNAL_AUTHORIZATION only applies to INTERNAL_CAPITAL.)
const DEFERRED_BY_COMMAND: Record<ProjectLifecycleCommand, string[]> = {
  start: [],
  'practical-completion': ['CONTRACT_PC_CERTIFICATE'],
  closeout: ['FINAL_ACCOUNT_AGREED'],
  close: [
    'FINAL_ACCOUNT_SETTLED',
    'OPEN_COMMITMENTS_CLEARED',
    'INVENTORY_RECONCILED',
    'RETENTION_RELEASED',
    'PROJECT_DOCUMENTS_COMPLETE',
  ],
  cancel: [],
};

function condition(
  code: string,
  severity: ReadinessConditionSeverity,
  satisfied: boolean,
  detail: string,
  satisfiedAt: Date | null = null,
): ProjectReadinessConditionResponse {
  return {
    code,
    severity,
    satisfied,
    detail,
    blockedBy: [], // resolved against the emitted set in `withDependencies`
    // A time is reported only for a condition that is satisfied now.
    satisfiedAt: satisfied && satisfiedAt ? satisfiedAt.toISOString() : null,
  };
}

/** Attach each condition's dependencies, limited to codes present in the same response. */
function withDependencies(
  conditions: ProjectReadinessConditionResponse[],
): ProjectReadinessConditionResponse[] {
  const present = new Set(conditions.map((c) => c.code));
  return conditions.map((c) => ({
    ...c,
    blockedBy: (READINESS_DEPENDENCIES[c.code] ?? []).filter((code) => present.has(code)),
  }));
}

/**
 * When the current uninterrupted period with more than one active member began — i.e. the join
 * that formed the delivery team, provided no removal has broken it since. Null when the team is
 * not formed now. Events at the same instant are applied together before the count is read.
 */
export function teamFormedAt(
  memberships: ReadonlyArray<{ joinedAt: Date; removedAt: Date | null }>,
): Date | null {
  const deltas = new Map<number, number>();
  for (const m of memberships) {
    const joined = m.joinedAt.getTime();
    deltas.set(joined, (deltas.get(joined) ?? 0) + 1);
    if (m.removedAt) {
      const removed = m.removedAt.getTime();
      deltas.set(removed, (deltas.get(removed) ?? 0) - 1);
    }
  }
  let count = 0;
  let formedAt: number | null = null;
  for (const at of [...deltas.keys()].sort((a, b) => a - b)) {
    const before = count;
    count += deltas.get(at) ?? 0;
    if (before <= 1 && count > 1) formedAt = at;
    else if (count <= 1) formedAt = null;
  }
  return formedAt === null ? null : new Date(formedAt);
}

// CONST-PLC-008 — readiness asserts that Preparation-stage prerequisites already exist; it does not
// re-collect them. For DRAFT → ACTIVE (Start), that means an assigned active client + executed main
// contract with a contractual start date (CLIENT_CONTRACT), a baselined BOQ that fixes scope, and —
// as waivable good practice — programme dates and a delivery team beyond the PM.
function startConditions(s: ReadinessSnapshot): { conditions: ProjectReadinessConditionResponse[]; deferred: string[] } {
  const conditions: ProjectReadinessConditionResponse[] = [];
  const deferred: string[] = [];
  const evidence = s.evidence;

  if (s.commercialModel === 'CLIENT_CONTRACT') {
    conditions.push(
      condition(
        'CLIENT_ACTIVE',
        'MANDATORY',
        s.clientId !== null && s.clientStatus === 'ACTIVE',
        'An active client must be assigned to the project.',
        null, // no honest source: assigned by create/PATCH without field-level history
      ),
      condition(
        'ACTIVE_MAIN_CONTRACT',
        'MANDATORY',
        s.activeContract?.status === 'ACTIVE',
        'An executed (ACTIVE) main client contract must exist for the project.',
        evidence?.contractActivatedAt ?? null,
      ),
      condition(
        'CONTRACT_START_DATE',
        'MANDATORY',
        s.activeContract?.startDate != null,
        'The main contract must carry a contractual start date (commencement evidence).',
        evidence?.contractStartDateSetAt ?? null,
      ),
    );
  } else {
    // INTERNAL_CAPITAL substitutes internal authorization/funding for the contract conditions
    // (CONST-PLC-005). The budget-authorization domain is unbuilt, so it is surfaced as deferred.
    deferred.push('INTERNAL_AUTHORIZATION');
  }

  conditions.push(
    condition(
      'BOQ_BASELINED',
      'MANDATORY',
      s.hasBaselinedBoq,
      'A baselined BOQ version fixes the scope the project executes against.',
      evidence?.boqCommittedAt ?? null,
    ),
    condition(
      'PROGRAMME_DATES',
      'WAIVABLE',
      s.startDate != null && s.expectedEndDate != null,
      'Planned start and expected end dates should be set before execution begins.',
      null, // no honest source: set by create/PATCH without field-level history
    ),
    condition(
      'DELIVERY_TEAM',
      'WAIVABLE',
      s.activeMemberCount > 1,
      'At least one delivery-team member beyond the project manager should be enrolled.',
      evidence ? teamFormedAt(evidence.memberships) : null,
    ),
  );

  return { conditions: withDependencies(conditions), deferred };
}

/**
 * Evaluate a project's readiness for a lifecycle command. `ready` is true only when every emitted
 * condition is satisfied — a WAIVABLE-but-unsatisfied condition still reports `ready: false`; it is
 * B2's job (CONST-PLC-006) to decide that an authorized waiver unblocks it.
 *
 * Start carries the full queryable condition set. practical-completion / closeout / close have no
 * queryable gate yet (their source domains — PC certificate, final account, commitments, inventory,
 * retention — do not expose project-scoped state), so they return ready with a `deferred` list that
 * names the real future conditions. cancel is an exit and carries no readiness conditions.
 */
export function evaluateReadiness(
  snapshot: ReadinessSnapshot,
  command: ProjectLifecycleCommand,
  authority: CallerAuthority = NO_AUTHORITY,
): ProjectReadinessResponse {
  const { conditions, deferred } =
    command === 'start'
      ? startConditions(snapshot)
      : { conditions: [] as ProjectReadinessConditionResponse[], deferred: DEFERRED_BY_COMMAND[command] };

  return {
    command,
    targetStatus: TARGET_STATUS[command],
    ready: conditions.every((c) => c.satisfied),
    conditions,
    deferred,
    caller: evaluateCaller(conditions, authority),
  };
}

// ── ADR-019 amendment 2026-09-28: readiness as seen by the caller ─────────────────

/**
 * What the service knows about the caller. `mayRun` = holds the command's permission;
 * `apexAuthority` = Start-chain apex (only ever true for `start`). Both are decided by the service
 * from the identity — the same inputs `enforceReadiness` uses — so the UI needs no role names.
 */
export interface CallerAuthority {
  mayRun: boolean;
  apexAuthority: boolean;
}

/** Fail-closed default: a readiness evaluated without a caller says the caller cannot run it. */
const NO_AUTHORITY: CallerAuthority = { mayRun: false, apexAuthority: false };

/**
 * `canRun` is exactly "would `planEnforcement` allow this caller, given a reason for every
 * condition they may waive" — the enforcement function itself is reused, so the read and the
 * command cannot disagree. Governance approval and lifecycle status are out of scope here.
 */
export function evaluateCaller(
  conditions: readonly ProjectReadinessConditionResponse[],
  authority: CallerAuthority,
): ProjectReadinessCallerResponse {
  const waivableConditions = conditions
    .filter(
      (c) =>
        !c.satisfied &&
        (c.severity === 'WAIVABLE' ||
          (authority.apexAuthority && APEX_WAIVABLE_START_CONDITIONS.has(c.code))),
    )
    .map((c) => c.code);
  const plan = planEnforcement(
    { conditions: [...conditions] },
    waivableConditions.map((code) => ({ condition: code, reason: 'reason supplied' })),
    { apexAuthority: authority.apexAuthority },
  );
  return { canRun: authority.mayRun && plan.allowed, waivableConditions };
}

// ── ADR-019 Phase B2 (CONST-PLC-004/006): turning readiness into enforcement ──────

/** A per-condition override: an authorized waiver of ONE specific failed WAIVABLE condition. */
export interface WaiverInput {
  condition: string;
  reason: string;
}

/**
 * ADR-026 CONST-VAR-011 (Route 7A) — the two MANDATORY Start conditions a project-before-contract
 * commencement may waive. They stay MANDATORY (a normal caller can NEVER waive them — CONST-PLC-006),
 * but are *apex-waivable*: an override targeting one of these succeeds ONLY when the waiver carries
 * Start-chain apex authority (CFO→CEO per CONST-DOA-006). This is a named, audited exception on the
 * existing gate — still per-condition, still `PROJECT_CONDITION_WAIVED`, still no whole-command force.
 */
export const APEX_WAIVABLE_START_CONDITIONS: ReadonlySet<string> = new Set([
  'ACTIVE_MAIN_CONTRACT',
  'CONTRACT_START_DATE',
]);

/**
 * The decision a command must act on: which unsatisfied conditions hard-block, which need a waiver,
 * which waivers were validly applied, and which overrides were invalid. Pure — the service turns a
 * `!allowed` plan into a 400 and records `appliedWaivers` as audit events.
 */
export interface EnforcementPlan {
  mandatoryBlockers: string[]; // unsatisfied MANDATORY → transition impossible
  requiresWaiver: string[]; // unsatisfied WAIVABLE with no valid override → blocked
  appliedWaivers: WaiverInput[]; // unsatisfied WAIVABLE with a valid override → proceed + record
  invalidOverrides: string[]; // override that does not target an unsatisfied WAIVABLE condition
  allowed: boolean;
}

/**
 * Options that unlock the ADR-026 Route 7A exception. Absent/false ⇒ pre-7A behaviour exactly
 * (MANDATORY is never waivable). `apexAuthority` is set by the service ONLY when the caller carries
 * Start-chain apex authority; it lets a waiver of the two `APEX_WAIVABLE_START_CONDITIONS` succeed.
 */
export interface EnforcementOptions {
  apexAuthority?: boolean;
}

/**
 * CONST-PLC-006 — MANDATORY conditions can never be waived; WAIVABLE ones are blocked by default
 * and unblocked only by an override that targets that *specific* failed condition with a non-empty
 * reason. An override that names a satisfied, MANDATORY, or unknown condition is invalid (you cannot
 * waive what is not a failed WAIVABLE condition) — surfaced rather than silently ignored. There is
 * no whole-transition `force`.
 *
 * ADR-026 CONST-VAR-011 (Route 7A) — the ONLY exception: the two `APEX_WAIVABLE_START_CONDITIONS`
 * (`ACTIVE_MAIN_CONTRACT` / `CONTRACT_START_DATE`) may be waived when — and only when — the caller
 * carries Start-chain apex authority (`options.apexAuthority`). Such a waiver is still per-condition,
 * still needs a non-empty reason, and is still recorded as a `PROJECT_CONDITION_WAIVED` audit event.
 * Without apex authority these conditions remain hard MANDATORY blockers, exactly as before.
 */
export function planEnforcement(
  readiness: Pick<ProjectReadinessResponse, 'conditions'>,
  overrides: WaiverInput[],
  options: EnforcementOptions = {},
): EnforcementPlan {
  const overrideFor = (code: string) =>
    overrides.find((o) => o.condition === code && o.reason.trim().length > 0);

  // A MANDATORY condition is apex-waivable only for the two named Start conditions AND only when the
  // caller holds apex authority. Everything else stays a hard blocker.
  const apexWaivable = (code: string) =>
    options.apexAuthority === true && APEX_WAIVABLE_START_CONDITIONS.has(code);

  const mandatoryBlockers: string[] = [];
  const requiresWaiver: string[] = [];
  const appliedWaivers: WaiverInput[] = [];

  for (const condition of readiness.conditions) {
    if (condition.satisfied) continue;
    if (condition.severity === 'MANDATORY' && !apexWaivable(condition.code)) {
      mandatoryBlockers.push(condition.code);
      continue;
    }
    const override = overrideFor(condition.code);
    if (override) appliedWaivers.push({ condition: condition.code, reason: override.reason.trim() });
    else requiresWaiver.push(condition.code);
  }

  // An override only makes sense against a condition that is unsatisfied AND waivable — either a
  // WAIVABLE condition, or (Route 7A) a named MANDATORY condition the caller is apex-authorised to waive.
  const waivableUnsatisfied = new Set(
    readiness.conditions
      .filter(
        (c) => !c.satisfied && (c.severity === 'WAIVABLE' || apexWaivable(c.code)),
      )
      .map((c) => c.code),
  );
  const invalidOverrides = overrides
    .filter((o) => o.reason.trim().length > 0 && !waivableUnsatisfied.has(o.condition))
    .map((o) => o.condition);

  return {
    mandatoryBlockers,
    requiresWaiver,
    appliedWaivers,
    invalidOverrides,
    allowed:
      mandatoryBlockers.length === 0 &&
      requiresWaiver.length === 0 &&
      invalidOverrides.length === 0,
  };
}
