/**
 * PO line cost-target validity — A3 / D7.
 *
 * Pure: it takes the two supplied ids plus the resolved facts about the BOQ node, and returns
 * a violation code or null. It never reads the database and never throws — the service turns a
 * violation into a `BadRequestException`. The point of pulling this out of the service is that
 * "what makes a cost-target valid" is a single rule that the create and revise paths must not
 * be able to answer differently.
 *
 * A3 — a line either carries a valid cost-target (project + BOQ node) OR is explicitly a
 * non-project/overhead line. Never a fabricated or half-specified attribution. The org/internal
 * exception is first-class here: NEITHER id supplied is a valid, allowed state (returns null).
 *
 * D7 — the cost-target is captured once here and is authoritative; downstream inherits it. So the
 * node must be a real, chargeable cost line on the named project's BOQ, not a section or a
 * deactivated node, and not a node belonging to some other project.
 */

export type CostTargetViolationCode =
  | 'COST_TARGET_INCOMPLETE' // exactly one of projectId / boqNodeId supplied
  | 'BOQ_NODE_NOT_FOUND' // boqNodeId does not resolve to a node in this org
  | 'BOQ_NODE_WRONG_PROJECT' // node exists but its BOQ belongs to a different project
  | 'BOQ_NODE_NOT_COST_NODE' // node is a section (not a leaf/billable item)
  | 'BOQ_NODE_INACTIVE'; // node has been deactivated (CONST-BOQ-003)

export interface CostTargetInput {
  projectId?: string | null;
  boqNodeId?: string | null;
}

/** The resolved facts about the supplied boqNode, or null when it did not resolve at all. */
export interface ResolvedBoqNode {
  /** The project that owns the BOQ this node lives on. */
  projectId: string;
  isLeaf: boolean;
  isActive: boolean;
}

/**
 * Returns a violation code, or null when the cost-target is valid — which includes the
 * fully-unspecified (org/overhead) line. `resolvedNode` is what the repository found for
 * `input.boqNodeId`; pass null when the id resolved to nothing.
 */
export function validateCostTarget(
  input: CostTargetInput,
  resolvedNode: ResolvedBoqNode | null,
): CostTargetViolationCode | null {
  const hasProject = !!input.projectId;
  const hasNode = !!input.boqNodeId;

  // Org / overhead line — no attribution at all. A3's first-class exception.
  if (!hasProject && !hasNode) return null;

  // Half-specified — a fabricated/blank attribution. Rejected either way round.
  if (hasProject !== hasNode) return 'COST_TARGET_INCOMPLETE';

  // Both supplied: the node must be a real, chargeable, active cost line on THIS project.
  if (!resolvedNode) return 'BOQ_NODE_NOT_FOUND';
  if (resolvedNode.projectId !== input.projectId) return 'BOQ_NODE_WRONG_PROJECT';
  if (!resolvedNode.isActive) return 'BOQ_NODE_INACTIVE';
  if (!resolvedNode.isLeaf) return 'BOQ_NODE_NOT_COST_NODE';

  return null;
}

export function costTargetViolationMessage(code: CostTargetViolationCode): string {
  switch (code) {
    case 'COST_TARGET_INCOMPLETE':
      return 'A cost-target needs both a project and a BOQ node, or neither (for an org/overhead line).';
    case 'BOQ_NODE_NOT_FOUND':
      return 'The BOQ node for this line does not exist.';
    case 'BOQ_NODE_WRONG_PROJECT':
      return 'The BOQ node does not belong to the given project.';
    case 'BOQ_NODE_NOT_COST_NODE':
      return 'The BOQ node is a section, not a billable cost item. Choose a leaf item.';
    case 'BOQ_NODE_INACTIVE':
      return 'The BOQ node has been deactivated and can no longer receive cost.';
  }
}
