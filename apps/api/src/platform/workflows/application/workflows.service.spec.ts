import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { WorkflowsService } from './workflows.service.js';

/**
 * WorkflowsService read paths. `listBindings` backs the governance-configuration view — it
 * passes the caller's org to the repo (which also folds in tenant-defaults) and returns the
 * bindings as-is; activation is not a service concern (ADR-007 keeps it a deliberate act).
 */
function build() {
  const repo = {
    findBindingsForOrg: jest.fn(),
    findDefinitionByType: jest.fn(),
    findDraftWithRules: jest.fn(),
    findRoleNames: jest.fn(),
    findPolicyWithRules: jest.fn(),
    findPolicyVersionsByKey: jest.fn(),
    findPolicyVersionsForComparison: jest.fn(),
    transitionPolicy: jest.fn(),
    clonePolicyToDraft: jest.fn(),
  };
  const svc = new WorkflowsService(repo as never);
  return { svc, repo };
}

function versionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'v1', policyKey: 'ACCO_GOVERNANCE', version: 1, status: 'ACTIVE',
    effectiveFrom: new Date('2026-08-17T00:00:00.000Z'), effectiveTo: null,
    createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    _count: { rules: 0 }, rules: [], segregationDutiesRules: [],
    ...over,
  };
}

describe('WorkflowsService.listBindings', () => {
  it('lists the org’s bindings via the repo, scoped to the active organization', async () => {
    const { svc, repo } = build();
    const bindings = [{ id: 'b1', entityType: 'SupplierBill', isActive: true }];
    repo.findBindingsForOrg.mockResolvedValue(bindings);

    await expect(svc.listBindings('o1')).resolves.toBe(bindings);
    expect(repo.findBindingsForOrg).toHaveBeenCalledWith('o1');
  });
});

describe('WorkflowsService draft authoring safeguards', () => {
  it('reports missing roles, duplicate priorities, SoD conflicts and overlapping bands', async () => {
    const { svc, repo } = build();
    repo.findRoleNames.mockResolvedValue(['FINANCE_MANAGER']);
    repo.findDraftWithRules.mockResolvedValue({ rules: [
      { id: 'r1', transactionType: 'PURCHASE_ORDER', priority: 1, configuration: { requiredRole: 'SYSTEM_ADMINISTRATOR', minAmount: '0', maxAmount: '100' } },
      { id: 'r2', transactionType: 'PURCHASE_ORDER', priority: 1, configuration: { requiredRole: 'MISSING_ROLE', minAmount: '50', maxAmount: '150' } },
    ] });
    const result = await svc.validateDraft('o1', 'p1');
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['SOD_CONFLICT', 'MISSING_ROLE', 'DUPLICATE_PRIORITY', 'OVERLAPPING_AMOUNT_BAND']));
  });

  it('simulates matching rules without calling any instance-creation repository operation', async () => {
    const { svc, repo } = build();
    repo.findDraftWithRules.mockResolvedValue({ id: 'p1', policyKey: 'PO', version: 1, rules: [
      { id: 'r1', ruleKey: 'PO_REVIEW', transactionType: 'PURCHASE_ORDER', priority: 10, configuration: { requiredRole: 'FINANCE_MANAGER', minAmount: '100', fromState: 'DRAFT', toState: 'SUBMITTED' } },
    ] });
    const result = await svc.simulateDraft('o1', 'p1', { transactionType: 'PURCHASE_ORDER' as never, amount: '200', fromState: 'DRAFT', toState: 'SUBMITTED' });
    expect(result).toMatchObject({ matched: true, roleChain: [{ ruleKey: 'PO_REVIEW', requiredRole: 'FINANCE_MANAGER' }] });
    expect((repo as Record<string, unknown>).createInstance).toBeUndefined();
  });
});

describe('WorkflowsService.getDefinitionForTransaction', () => {
  it('throws when no active definition exists for the transaction type', async () => {
    const { svc, repo } = build();
    repo.findDefinitionByType.mockResolvedValue(null);

    await expect(svc.getDefinitionForTransaction('o1', 'PURCHASE_ORDER' as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * Four-eyes on schedule/publish (ADR-027 GOV-ADM-007). The submitter of an IN_REVIEW version may
 * not be the actor who schedules (publishes) it — the guard at workflows.service.ts must reject
 * before the transition ever reaches the repository.
 */
describe('WorkflowsService.schedulePolicy four-eyes', () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  it('rejects when the submitter tries to schedule their own version, without transitioning', async () => {
    const { svc, repo } = build();
    repo.findPolicyWithRules.mockResolvedValue({ id: 'p1', status: 'IN_REVIEW', submittedByUserId: 'same-user' });

    await expect(
      svc.schedulePolicy('o1', 'p1', 'same-user', 'go live', future),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.transitionPolicy).not.toHaveBeenCalled();
  });

  it('allows a different actor to schedule a submitted version for a future effective date', async () => {
    const { svc, repo } = build();
    repo.findPolicyWithRules.mockResolvedValue({ id: 'p1', status: 'IN_REVIEW', submittedByUserId: 'submitter' });
    repo.transitionPolicy.mockResolvedValue({ id: 'p1', status: 'SCHEDULED' });

    await expect(svc.schedulePolicy('o1', 'p1', 'publisher', 'go live', future)).resolves.toEqual({ id: 'p1', status: 'SCHEDULED' });
    expect(repo.transitionPolicy).toHaveBeenCalledWith('o1', 'p1', 'publisher', 'IN_REVIEW', 'SCHEDULED', 'go live', future);
  });
});

/**
 * Rollback clone (ADR-027). The service delegates to the repository, which is proven at the
 * repository layer (workflows-prisma.repository.rollback-clone.spec) to create a DRAFT at
 * version+1, copy rules PENDING + SoD rules inactive with the versioned code suffix, and write
 * the APPROVAL_POLICY_ROLLBACK_CLONED audit log + outbox event. The service maps a missing source
 * to a 404.
 */
describe('WorkflowsService.clonePolicyToDraft', () => {
  it('returns the cloned draft the repository produced', async () => {
    const { svc, repo } = build();
    repo.clonePolicyToDraft.mockResolvedValue({ id: 'clone-1', version: 2, status: 'DRAFT' });
    await expect(svc.clonePolicyToDraft('o1', 'p1', 'actor', 'roll back')).resolves.toEqual({ id: 'clone-1', version: 2, status: 'DRAFT' });
    expect(repo.clonePolicyToDraft).toHaveBeenCalledWith('o1', 'p1', 'actor', 'roll back');
  });

  it('404s when the source version does not exist', async () => {
    const { svc, repo } = build();
    repo.clonePolicyToDraft.mockResolvedValue(null);
    await expect(svc.clonePolicyToDraft('o1', 'missing', 'actor', 'roll back')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkflowsService.listPolicyVersionsByKey', () => {
  it('returns every version of a key as a summary, newest first (as ordered by the repo)', async () => {
    const { svc, repo } = build();
    repo.findPolicyVersionsByKey.mockResolvedValue([
      versionRow({ id: 'v2', version: 2, status: 'DRAFT', _count: { rules: 3 } }),
      versionRow({ id: 'v1', version: 1, status: 'ACTIVE', _count: { rules: 2 } }),
    ]);
    const result = await svc.listPolicyVersionsByKey('o1', ' ACCO_GOVERNANCE ');
    expect(repo.findPolicyVersionsByKey).toHaveBeenCalledWith('o1', 'ACCO_GOVERNANCE');
    expect(result.policyKey).toBe('ACCO_GOVERNANCE');
    expect(result.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(result.versions[0]).toMatchObject({ id: 'v2', status: 'DRAFT', ruleCount: 3 });
    expect(result.versions[1].effectiveFrom).toBe('2026-08-17T00:00:00.000Z');
  });

  it('404s when the key has no versions', async () => {
    const { svc, repo } = build();
    repo.findPolicyVersionsByKey.mockResolvedValue([]);
    await expect(svc.listPolicyVersionsByKey('o1', 'UNKNOWN')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkflowsService.comparePolicyVersions', () => {
  const ruleA = { ruleKey: 'PO_CFO', transactionType: 'PURCHASE_ORDER', priority: 1, configuration: { requiredRole: 'CFO', minAmount: '1000.01', maxAmount: '50000.01', fromState: 'DRAFT', toState: 'SUBMITTED' } };

  it('reports added, removed, and changed rules plus SoD differences across the same key', async () => {
    const { svc, repo } = build();
    repo.findPolicyVersionsForComparison.mockResolvedValue([
      versionRow({
        id: 'base', version: 1, _count: { rules: 2 },
        rules: [
          ruleA,
          { ruleKey: 'PO_CEO', transactionType: 'PURCHASE_ORDER', priority: 2, configuration: { requiredRole: 'CEO' } },
        ],
        segregationDutiesRules: [{ code: 'SOD_A', description: 'a', isActive: true }],
      }),
      versionRow({
        id: 'target', version: 2, _count: { rules: 2 },
        rules: [
          { ...ruleA, configuration: { ...ruleA.configuration, requiredRole: 'FINANCE_OFFICER', priority: 5 } },
          { ruleKey: 'PO_BOARD', transactionType: 'PURCHASE_ORDER', priority: 3, configuration: { requiredRole: 'BOARD' } },
        ],
        segregationDutiesRules: [{ code: 'SOD_A_V2', description: 'a', isActive: false }],
      }),
    ]);

    const result = await svc.comparePolicyVersions('o1', 'base', 'target');
    expect(result.rules.added.map((r) => r.ruleKey)).toEqual(['PO_BOARD']);
    expect(result.rules.removed.map((r) => r.ruleKey)).toEqual(['PO_CEO']);
    expect(result.rules.changed).toHaveLength(1);
    expect(result.rules.changed[0].ruleKey).toBe('PO_CFO');
    const requiredRoleChange = result.rules.changed[0].changes.find((c) => c.field === 'requiredRole');
    expect(requiredRoleChange).toEqual({ field: 'requiredRole', base: 'CFO', target: 'FINANCE_OFFICER' });
    // SoD codes are compared on their canonical (unversioned) code; only isActive changed.
    expect(result.sodRules).toEqual([{ code: 'SOD_A', base: { description: 'a', isActive: true }, target: { description: 'a', isActive: false } }]);
  });

  it('rejects comparing a version to itself', async () => {
    const { svc } = build();
    await expect(svc.comparePolicyVersions('o1', 'v1', 'v1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when either version is missing', async () => {
    const { svc, repo } = build();
    repo.findPolicyVersionsForComparison.mockResolvedValue([versionRow({ id: 'base' })]);
    await expect(svc.comparePolicyVersions('o1', 'base', 'target')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects comparing versions of different policy keys', async () => {
    const { svc, repo } = build();
    repo.findPolicyVersionsForComparison.mockResolvedValue([
      versionRow({ id: 'base', policyKey: 'ACCO_GOVERNANCE' }),
      versionRow({ id: 'target', policyKey: 'OTHER_KEY' }),
    ]);
    await expect(svc.comparePolicyVersions('o1', 'base', 'target')).rejects.toBeInstanceOf(BadRequestException);
  });
});
