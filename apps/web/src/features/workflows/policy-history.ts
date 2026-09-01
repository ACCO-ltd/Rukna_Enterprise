/**
 * Renders the governance action names the audit log stores into plain operational English.
 *
 * The backend writes these strings on the policy `auditLog` (see `workflows-prisma.repository`):
 *  - lifecycle: `APPROVAL_POLICY_${to}` where `to` is the target status (IN_REVIEW, SCHEDULED,
 *    ACTIVE, RETIRED, SUPERSEDED)
 *  - rules: `APPROVAL_POLICY_RULE_UPDATED`, `APPROVAL_POLICY_RULE_DELETED`,
 *    `APPROVAL_POLICY_RULES_REORDERED`
 *  - SoD: `APPROVAL_POLICY_SOD_CONFIGURED`
 *  - clone: `APPROVAL_POLICY_ROLLBACK_CLONED`
 *
 * An unmapped action falls back to its de-prefixed, title-cased form rather than a raw constant,
 * so a new backend action is still legible before this map catches up.
 */
const ACTION_LABELS: Record<string, string> = {
  APPROVAL_POLICY_IN_REVIEW: 'Submitted for review',
  APPROVAL_POLICY_SCHEDULED: 'Scheduled',
  APPROVAL_POLICY_ACTIVE: 'Activated',
  APPROVAL_POLICY_RETIRED: 'Retired',
  APPROVAL_POLICY_SUPERSEDED: 'Superseded',
  APPROVAL_POLICY_RULE_UPDATED: 'Rule updated',
  APPROVAL_POLICY_RULE_DELETED: 'Rule deleted',
  APPROVAL_POLICY_RULES_REORDERED: 'Rules reordered',
  APPROVAL_POLICY_SOD_CONFIGURED: 'Segregation-of-duties rule configured',
  APPROVAL_POLICY_ROLLBACK_CLONED: 'Cloned to a new draft',
};

export function humanizePolicyAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const stripped = action.replace(/^APPROVAL_POLICY_/, '').replace(/_/g, ' ').toLowerCase();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
