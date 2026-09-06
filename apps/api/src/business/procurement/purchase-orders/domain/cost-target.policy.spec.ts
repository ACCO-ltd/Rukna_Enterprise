import { validateCostTarget, type ResolvedBoqNode } from './cost-target.policy.js';

const leafOnProjectA: ResolvedBoqNode = { projectId: 'proj-A', isLeaf: true, isActive: true };

describe('validateCostTarget (A3/D7)', () => {
  // A3 — the org/overhead exception is a first-class valid state, not a defect.
  it('allows a line with neither project nor node (org/overhead line)', () => {
    expect(validateCostTarget({}, null)).toBeNull();
    expect(validateCostTarget({ projectId: undefined, boqNodeId: undefined }, null)).toBeNull();
  });

  // A3 — a fully-specified, valid target on the right project is accepted.
  it('allows a project-cost-relevant line whose node is a leaf on the given project', () => {
    expect(
      validateCostTarget({ projectId: 'proj-A', boqNodeId: 'node-1' }, leafOnProjectA),
    ).toBeNull();
  });

  /**
   * Project-level (non-BOQ) cost. A construction BOQ is the contractual measured scope, not the
   * complete internal cost structure — site security, transport, insurance and supervision are
   * real project cost with no BOQ line to charge. Before this was allowed, the only options were
   * an invented "Site overhead" BOQ node or losing the cost into corporate overhead, and a
   * ProjectCostBudget could plan a category that no purchase could ever consume.
   */
  it('allows a project line with a spend category and no BOQ node', () => {
    expect(
      validateCostTarget({ projectId: 'proj-A', spendCategoryId: 'cat-transport' }, null),
    ).toBeNull();
  });

  /** A project with no target at all is an unclassified suspense bucket nobody reconciles. */
  it('rejects a project with neither a node nor a category', () => {
    expect(validateCostTarget({ projectId: 'proj-A' }, null)).toBe('PROJECT_WITHOUT_COST_TARGET');
  });

  /** A BOQ node lives on a project's BOQ; outside one it means nothing. */
  it('rejects a node without a project', () => {
    expect(validateCostTarget({ boqNodeId: 'node-1' }, leafOnProjectA)).toBe(
      'BOQ_NODE_WITHOUT_PROJECT',
    );
  });

  /** The BOQ node wins when both are given — it is the more specific attribution. */
  it('validates the node when a category is also supplied', () => {
    expect(
      validateCostTarget(
        { projectId: 'proj-A', boqNodeId: 'node-1', spendCategoryId: 'cat-materials' },
        leafOnProjectA,
      ),
    ).toBeNull();
  });

  /** A category on a corporate line changes nothing — no project, no project attribution. */
  it('still allows a corporate line that happens to carry a category', () => {
    expect(validateCostTarget({ spendCategoryId: 'cat-admin' }, null)).toBeNull();
  });

  // D7 — the node must be real, on the named project, active, and a chargeable leaf.
  it('rejects when the node does not resolve', () => {
    expect(validateCostTarget({ projectId: 'proj-A', boqNodeId: 'ghost' }, null)).toBe(
      'BOQ_NODE_NOT_FOUND',
    );
  });

  it('rejects when the node belongs to a different project', () => {
    const nodeOnB: ResolvedBoqNode = { projectId: 'proj-B', isLeaf: true, isActive: true };
    expect(validateCostTarget({ projectId: 'proj-A', boqNodeId: 'node-1' }, nodeOnB)).toBe(
      'BOQ_NODE_WRONG_PROJECT',
    );
  });

  it('rejects a section (non-leaf) node', () => {
    const section: ResolvedBoqNode = { projectId: 'proj-A', isLeaf: false, isActive: true };
    expect(validateCostTarget({ projectId: 'proj-A', boqNodeId: 'sec-1' }, section)).toBe(
      'BOQ_NODE_NOT_COST_NODE',
    );
  });

  it('rejects a deactivated node', () => {
    const inactive: ResolvedBoqNode = { projectId: 'proj-A', isLeaf: true, isActive: false };
    expect(validateCostTarget({ projectId: 'proj-A', boqNodeId: 'node-1' }, inactive)).toBe(
      'BOQ_NODE_INACTIVE',
    );
  });
});
