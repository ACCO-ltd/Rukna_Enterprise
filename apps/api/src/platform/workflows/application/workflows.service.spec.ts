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

describe('WorkflowsService.getDefinitionForTransaction', () => {
  it('throws when no active definition exists for the transaction type', async () => {
    const { svc, repo } = build();
    repo.findDefinitionByType.mockResolvedValue(null);

    await expect(svc.getDefinitionForTransaction('o1', 'PURCHASE_ORDER' as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
