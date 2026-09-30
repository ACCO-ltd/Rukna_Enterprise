/**
 * Renders the governance action names the audit log stores into plain operational English — a
 * verb phrase that reads after the actor's name on the history timeline ("Hodan Abdi activated
 * the policy").
 *
 * The backend writes these strings on the policy `auditLog` (see `workflows-prisma.repository`):
 *  - lifecycle: `APPROVAL_POLICY_${to}` where `to` is the target status (IN_REVIEW, SCHEDULED,
 *    ACTIVE, RETIRED, SUPERSEDED)
 *  - rules: `APPROVAL_POLICY_RULE_UPDATED`, `APPROVAL_POLICY_RULE_DELETED`,
 *    `APPROVAL_POLICY_RULES_REORDERED`
 *  - SoD: `APPROVAL_POLICY_SOD_CONFIGURED`
 *  - clone: `APPROVAL_POLICY_ROLLBACK_CLONED`
 *
 * An unmapped action falls back to its de-prefixed, lower-cased form ("recorded: rule archived")
 * rather than a raw constant, so a new backend action is still legible before this map catches up.
 */
const ACTION_LABELS: Record<string, string> = {
  APPROVAL_POLICY_IN_REVIEW: 'submitted the policy for review',
  APPROVAL_POLICY_SCHEDULED: 'scheduled the policy',
  APPROVAL_POLICY_ACTIVE: 'activated the policy',
  APPROVAL_POLICY_RETIRED: 'retired the policy',
  APPROVAL_POLICY_SUPERSEDED: 'superseded the policy',
  APPROVAL_POLICY_RULE_UPDATED: 'updated a rule',
  APPROVAL_POLICY_RULE_DELETED: 'deleted a rule',
  APPROVAL_POLICY_RULES_REORDERED: 'reordered the rules',
  APPROVAL_POLICY_SOD_CONFIGURED: 'configured a segregation-of-duties rule',
  APPROVAL_POLICY_ROLLBACK_CLONED: 'cloned the policy to a new draft',
};

export function humanizePolicyAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const stripped = action.replace(/^APPROVAL_POLICY_/, '').replace(/_/g, ' ').toLowerCase();
  return `recorded: ${stripped}`;
}
