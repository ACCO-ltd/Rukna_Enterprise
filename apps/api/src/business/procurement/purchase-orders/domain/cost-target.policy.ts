/**
 * PO line cost-target validity — A3 / D7.
 *
 * Pure: it takes the supplied ids plus the resolved facts about the BOQ node, and returns a
 * violation code or null. It never reads the database and never throws — the service turns a
 * violation into a `BadRequestException`. The point of pulling this out of the service is that
 * "what makes a cost-target valid" is a single rule that the create and revise paths must not be
 * able to answer differently.
 *
 * ─── The three valid attributions ────────────────────────────────────────────────
 *
 *   1. Corporate / non-project      projectId = null,    boqNodeId = null
 *   2. Project-level (non-BOQ)      projectId = set,     boqNodeId = null,  spendCategory = set
 *   3. BOQ-coded project cost       projectId = set,     boqNodeId = set
 *
 * State 2 is new (2026-09-06). The rule used to be "both ids or neither", which made a whole
 * class of legitimate project cost impossible to record: site security, temporary utilities,
 * project transport, insurance, supervision, fuel, permits. A construction BOQ is the
 * **contractual measured scope**, not the complete internal cost-accounting structure, and
 * forcing those costs into invented BOQ items would corrupt exactly that distinction. The only
 * alternatives the old rule left were a fake "Site overhead" BOQ node or losing real project
 * cost into corporate overhead — both worse.
 *
 * It also made `ProjectCostBudget` internally inconsistent: a budget line may target a project
 * spend category, so a budget could be planned that no purchase could ever consume. A budget
 * category that can never receive actual cost is a reporting artefact, not a cost control.
 *
 * Two invariants replace the old symmetric one:
 *
 *   - **A BOQ node requires a project.** A node cannot exist meaningfully outside one.
 *   - **A project requires a cost target.** Either a BOQ node or a spend category — never a
 *     project with no target at all, which would be an unclassified suspense bucket nobody
 *     reconciles.
 *
 * D7 is unchanged: the cost-target is captured once here and is authoritative; downstream (goods
 * receipt, PO-backed bill, commitment ledger) inherits it read-only and may never recode it.
 */

export type CostTargetViolationCode =
  | 'BOQ_NODE_WITHOUT_PROJECT' // a BOQ node cannot exist outside a project
  | 'PROJECT_WITHOUT_COST_TARGET' // a project line must say what it is spending on
  | 'BOQ_NODE_NOT_FOUND' // boqNodeId does not resolve to a node in this org
  | 'BOQ_NODE_WRONG_PROJECT' // node exists but its BOQ belongs to a different project
  | 'BOQ_NODE_NOT_COST_NODE' // node is a section (not a leaf/billable item)
  | 'BOQ_NODE_INACTIVE'; // node has been deactivated (CONST-BOQ-003)

export interface CostTargetInput {
  projectId?: string | null;
  boqNodeId?: string | null;
  /**
   * The project-level cost target. Required when a project is named without a BOQ node, so
   * project-level spend is categorised rather than landing in an unnamed bucket.
   */
  spendCategoryId?: string | null;
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
 * fully-unspecified (corporate/overhead) line. `resolvedNode` is what the repository found for
 * `input.boqNodeId`; pass null when the id resolved to nothing.
 */
export function validateCostTarget(
  input: CostTargetInput,
  resolvedNode: ResolvedBoqNode | null,
): CostTargetViolationCode | null {
  const hasProject = !!input.projectId;
  const hasNode = !!input.boqNodeId;
  const hasCategory = !!input.spendCategoryId;

  // A BOQ node outside a project is meaningless — the node belongs to a project's BOQ.
  if (hasNode && !hasProject) return 'BOQ_NODE_WITHOUT_PROJECT';

  // Corporate / overhead line — no project attribution at all. A3's first-class exception.
  if (!hasProject) return null;

  // Project-level (non-BOQ) cost. Legitimate, and must still say what it is for.
  if (!hasNode) return hasCategory ? null : 'PROJECT_WITHOUT_COST_TARGET';

  // BOQ-coded: the node must be a real, chargeable, active cost line on THIS project.
  if (!resolvedNode) return 'BOQ_NODE_NOT_FOUND';
  if (resolvedNode.projectId !== input.projectId) return 'BOQ_NODE_WRONG_PROJECT';
  if (!resolvedNode.isActive) return 'BOQ_NODE_INACTIVE';
  if (!resolvedNode.isLeaf) return 'BOQ_NODE_NOT_COST_NODE';

  return null;
}

export function costTargetViolationMessage(code: CostTargetViolationCode): string {
  switch (code) {
    case 'BOQ_NODE_WITHOUT_PROJECT':
      return 'A BOQ node cannot be used without the project it belongs to.';
    case 'PROJECT_WITHOUT_COST_TARGET':
      return 'A project line needs a cost target: either a BOQ node, or a spend category for project-level cost such as transport, insurance or site overhead.';
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
