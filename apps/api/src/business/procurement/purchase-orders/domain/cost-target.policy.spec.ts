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

  // A3 — a half-specified target is a fabricated attribution. Rejected both ways round.
  it('rejects a project without a node', () => {
    expect(validateCostTarget({ projectId: 'proj-A' }, null)).toBe('COST_TARGET_INCOMPLETE');
  });

  it('rejects a node without a project', () => {
    expect(validateCostTarget({ boqNodeId: 'node-1' }, leafOnProjectA)).toBe(
      'COST_TARGET_INCOMPLETE',
    );
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
