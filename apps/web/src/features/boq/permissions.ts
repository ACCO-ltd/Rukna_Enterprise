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
  /** Any BOQ screen, and the commercial figures on it. */
  view: 'view:boq',
  /** Create and edit nodes, start and discard revisions. */
  manage: 'manage:boq',
  /** Baseline a version — the transition a contract is signed against. */
  baseline: 'baseline:boq',
} as const satisfies Record<string, PermissionKey>;
