import type { PermissionKey } from '@/features/auth/permissions/can';

/**
 * BOQ permissions, taken verbatim from the API catalogue
 * (`packages/types/src/permissions.ts`) — no renaming, unlike the accounting set.
 *
 * All three already match the live `action:resource` convention, so there is nothing to
 * reconcile. The BOQ feature had no `can()` call anywhere before ADR-016: every affordance
 * was gated on version state alone, which meant a viewer saw an Add item button that the
 * server would refuse.
 *
 * The API remains the security boundary. These hide what a user cannot do; the workspace
 * query separately withholds rate and amount values, so a restricted user is not merely
 * shown a blank — the figures never reach the browser.
 */
export const BOQ_PERMISSIONS = {
  /** Any BOQ screen (scope, quantities, progress — no money). */
  view: 'view:boq',
  /** Create and edit nodes, start and discard revisions (the manage umbrella). */
  manage: 'manage:boq',
  /**
   * @deprecated ADR-029 M-5 — the baseline transition is now `commit:boq`. Retained so any
   * pre-commit `can()` call keeps compiling for one release; new code gates on `commit`.
   */
  baseline: 'baseline:boq',
  /**
   * ADR-029 CONST-BOQ-034 — commit the working draft to contract (WORKING → COMMITTED). The
   * server still enforces; this only decides whether the primary "Commit to contract" affordance
   * is offered. Prefer `workspace.capabilities.canCommit` when the read model carries it.
   */
  commit: 'commit:boq',
  /** ADR-029 CONST-BOQ-028 — draw down the contingency allowance to fund work. */
  manageContingency: 'manage-contingency:boq',
} as const satisfies Record<string, PermissionKey>;
