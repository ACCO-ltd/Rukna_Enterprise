import { NotFoundException } from '@nestjs/common';

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
  };
  const svc = new WorkflowsService(repo as never);
  return { svc, repo };
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
