import type {
  ProjectLifecycleCommand,
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
}

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
): ProjectReadinessConditionResponse {
  return { code, severity, satisfied, detail };
}

// CONST-PLC-008 — readiness asserts that Preparation-stage prerequisites already exist; it does not
// re-collect them. For DRAFT → ACTIVE (Start), that means an assigned active client + executed main
// contract with a contractual start date (CLIENT_CONTRACT), a baselined BOQ that fixes scope, and —
// as waivable good practice — programme dates and a delivery team beyond the PM.
function startConditions(s: ReadinessSnapshot): { conditions: ProjectReadinessConditionResponse[]; deferred: string[] } {
  const conditions: ProjectReadinessConditionResponse[] = [];
  const deferred: string[] = [];

  if (s.commercialModel === 'CLIENT_CONTRACT') {
    conditions.push(
      condition(
        'CLIENT_ACTIVE',
        'MANDATORY',
        s.clientId !== null && s.clientStatus === 'ACTIVE',
        'An active client must be assigned to the project.',
      ),
      condition(
        'ACTIVE_MAIN_CONTRACT',
        'MANDATORY',
        s.activeContract?.status === 'ACTIVE',
        'An executed (ACTIVE) main client contract must exist for the project.',
      ),
      condition(
        'CONTRACT_START_DATE',
        'MANDATORY',
        s.activeContract?.startDate != null,
        'The main contract must carry a contractual start date (commencement evidence).',
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
    ),
    condition(
      'PROGRAMME_DATES',
      'WAIVABLE',
      s.startDate != null && s.expectedEndDate != null,
      'Planned start and expected end dates should be set before execution begins.',
    ),
    condition(
      'DELIVERY_TEAM',
      'WAIVABLE',
      s.activeMemberCount > 1,
      'At least one delivery-team member beyond the project manager should be enrolled.',
    ),
  );

  return { conditions, deferred };
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
  };
}

// ── ADR-019 Phase B2 (CONST-PLC-004/006): turning readiness into enforcement ──────

/** A per-condition override: an authorized waiver of ONE specific failed WAIVABLE condition. */
export interface WaiverInput {
  condition: string;
  reason: string;
}

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
 * CONST-PLC-006 — MANDATORY conditions can never be waived; WAIVABLE ones are blocked by default
 * and unblocked only by an override that targets that *specific* failed condition with a non-empty
 * reason. An override that names a satisfied, MANDATORY, or unknown condition is invalid (you cannot
 * waive what is not a failed WAIVABLE condition) — surfaced rather than silently ignored. There is
 * no whole-transition `force`.
 */
export function planEnforcement(
  readiness: ProjectReadinessResponse,
  overrides: WaiverInput[],
): EnforcementPlan {
  const overrideFor = (code: string) =>
    overrides.find((o) => o.condition === code && o.reason.trim().length > 0);

  const mandatoryBlockers: string[] = [];
  const requiresWaiver: string[] = [];
  const appliedWaivers: WaiverInput[] = [];

  for (const condition of readiness.conditions) {
    if (condition.satisfied) continue;
    if (condition.severity === 'MANDATORY') {
      mandatoryBlockers.push(condition.code);
      continue;
    }
    const override = overrideFor(condition.code);
    if (override) appliedWaivers.push({ condition: condition.code, reason: override.reason.trim() });
    else requiresWaiver.push(condition.code);
  }

  // An override only makes sense against a condition that is unsatisfied AND waivable.
  const waivableUnsatisfied = new Set(
    readiness.conditions
      .filter((c) => !c.satisfied && c.severity === 'WAIVABLE')
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
