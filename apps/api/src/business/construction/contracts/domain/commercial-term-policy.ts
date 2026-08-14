import type { ContractStatus } from '@prisma/client';

/**
 * CONST-COM-001 / CONST-COM-002 / CONST-COM-008 — Commercial term lifecycle policy.
 *
 * Single backend-owned authority for "may this commercial mutation happen given the
 * contract's current lifecycle status?". The frontend consumes the derived capabilities
 * (Gate B) but MUST NOT re-implement this table — the backend command is the gate.
 *
 * Two classes of mutation:
 *
 *  - SUBSTANTIVE (baseline) mutations change the immutable commercial baseline
 *    (contract header, retention terms, advance terms, adding a guarantee, adding a
 *    milestone). Allowed only while the contract is DRAFT. Once it leaves DRAFT the
 *    baseline is frozen; material change must eventually flow through Variations
 *    (deferred — not part of this delivery).
 *
 *  - OPERATIONAL mutations record real-world events against a live contract and are an
 *    explicit exception to the baseline freeze:
 *      · GUARANTEE_STATUS   — marking a bond DISCHARGED/CALLED/etc. Allowed in any
 *                             non-terminal status.
 *      · MILESTONE_COMPLETE — recording that a commercial milestone was achieved.
 *                             Only meaningful once the contract is executing, so allowed
 *                             in ACTIVE and FINAL_ACCOUNT_PENDING.
 *
 * PROVISIONAL: the operational carve-outs (which statuses permit guarantee-status and
 * milestone-completion changes) are provisional pending confirmation from Eng Ahmed
 * Shirie. Documented in ADR-017.
 */

export type CommercialMutationKind =
  | 'CONTRACT_HEADER'
  | 'RETENTION_TERMS'
  | 'ADVANCE_TERM'
  | 'GUARANTEE_TERM'
  | 'MILESTONE_TERM'
  | 'GUARANTEE_STATUS'
  | 'MILESTONE_COMPLETE';

export interface TermPolicyDecision {
  allowed: boolean;
  /** Machine-stable reason code, present only when allowed === false. */
  reason?: string;
}

const TERMINAL_STATUSES: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  'CLOSED',
  'CANCELLED',
  'TERMINATED',
]);

const SUBSTANTIVE_KINDS: ReadonlySet<CommercialMutationKind> = new Set<CommercialMutationKind>([
  'CONTRACT_HEADER',
  'RETENTION_TERMS',
  'ADVANCE_TERM',
  'GUARANTEE_TERM',
  'MILESTONE_TERM',
]);

const MILESTONE_COMPLETE_STATUSES: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  'ACTIVE',
  'FINAL_ACCOUNT_PENDING',
]);

export const CommercialTermPolicy = {
  /**
   * Decide whether a commercial mutation is permitted for a contract in `status`.
   * Pure and side-effect free so it can be unit-tested exhaustively and reused by the
   * Gate B capability projection.
   */
  evaluate(status: ContractStatus, kind: CommercialMutationKind): TermPolicyDecision {
    if (SUBSTANTIVE_KINDS.has(kind)) {
      if (status === 'DRAFT') return { allowed: true };
      return {
        allowed: false,
        reason:
          status === 'UNDER_REVIEW'
            ? 'CONTRACT_UNDER_REVIEW'
            : TERMINAL_STATUSES.has(status)
              ? 'CONTRACT_TERMINAL'
              : 'CONTRACT_BASELINE_FROZEN',
      };
    }

    if (kind === 'GUARANTEE_STATUS') {
      if (TERMINAL_STATUSES.has(status)) {
        return { allowed: false, reason: 'CONTRACT_TERMINAL' };
      }
      return { allowed: true };
    }

    // MILESTONE_COMPLETE
    if (MILESTONE_COMPLETE_STATUSES.has(status)) return { allowed: true };
    return {
      allowed: false,
      reason: TERMINAL_STATUSES.has(status) ? 'CONTRACT_TERMINAL' : 'CONTRACT_NOT_EXECUTING',
    };
  },

  isTerminal(status: ContractStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  },
} as const;
