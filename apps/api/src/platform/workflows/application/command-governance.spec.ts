import { Decimal } from '@prisma/client/runtime/library';

import { CommandGovernanceService } from './command-governance.service.js';

/**
 * ADR-015 — approval loop-back (mechanism "re-drive"). gateStateTransition reconciles
 * against any prior approval for the resource before opening a new one:
 *   APPROVED  → consume (single-use) and proceed (null)
 *   PENDING   → return the same instance, no duplicate
 *   none/terminal → open a fresh approval and gate
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

const binding = {
  workflowDefinitionId: 'wd1',
  definition: { transactionType: 'PURCHASE_ORDER' },
};

function build() {
  const triggerResolver = { resolveForStateTransition: jest.fn() };
  const repo = {
    findLatestInstanceForTransaction: jest.fn(),
    markInstanceConsumed: jest.fn().mockResolvedValue({}),
    createInstance: jest.fn().mockResolvedValue({ id: 'new-inst' }),
  };
  const svc = new CommandGovernanceService(triggerResolver as never, repo as never);
  return { svc, triggerResolver, repo };
}

describe('CommandGovernanceService.gateStateTransition — loop-back (ADR-015)', () => {
  it('no binding → proceeds (null), never touches instances', async () => {
    const { svc, triggerResolver, repo } = build();
    triggerResolver.resolveForStateTransition.mockResolvedValue(null);

    expect(await svc.gateStateTransition(identity, 'PurchaseOrder', 'DRAFT', 'SUBMITTED', 'po1')).toBeNull();
    expect(repo.findLatestInstanceForTransaction).not.toHaveBeenCalled();
    expect(repo.createInstance).not.toHaveBeenCalled();
  });

  it('binding + no prior instance → creates one and gates', async () => {
    const { svc, triggerResolver, repo } = build();
    triggerResolver.resolveForStateTransition.mockResolvedValue(binding);
    repo.findLatestInstanceForTransaction.mockResolvedValue(null);

    const r = await svc.gateStateTransition(identity, 'PurchaseOrder', 'DRAFT', 'SUBMITTED', 'po1');
    expect(r).toEqual({ gated: true, approvalInstanceId: 'new-inst' });
    expect(repo.createInstance).toHaveBeenCalled();
  });

  it('binding + PENDING instance → returns the same instance, no duplicate', async () => {
    const { svc, triggerResolver, repo } = build();
    triggerResolver.resolveForStateTransition.mockResolvedValue(binding);
    repo.findLatestInstanceForTransaction.mockResolvedValue({ id: 'pending-1', status: 'PENDING' });

    const r = await svc.gateStateTransition(identity, 'PurchaseOrder', 'DRAFT', 'SUBMITTED', 'po1');
    expect(r).toEqual({ gated: true, approvalInstanceId: 'pending-1' });
    expect(repo.createInstance).not.toHaveBeenCalled();
  });

  it('binding + APPROVED instance → consumes it and proceeds (null)', async () => {
    const { svc, triggerResolver, repo } = build();
    triggerResolver.resolveForStateTransition.mockResolvedValue(binding);
    repo.findLatestInstanceForTransaction.mockResolvedValue({ id: 'appr-1', status: 'APPROVED' });

    const r = await svc.gateStateTransition(identity, 'PurchaseOrder', 'DRAFT', 'SUBMITTED', 'po1');
    expect(r).toBeNull();
    expect(repo.markInstanceConsumed).toHaveBeenCalledWith('appr-1');
    expect(repo.createInstance).not.toHaveBeenCalled();
  });

  it('binding + already-consumed (CANCELLED) instance → opens a fresh approval', async () => {
    const { svc, triggerResolver, repo } = build();
    triggerResolver.resolveForStateTransition.mockResolvedValue(binding);
    repo.findLatestInstanceForTransaction.mockResolvedValue({ id: 'old', status: 'CANCELLED' });

    const r = await svc.gateStateTransition(identity, 'PurchaseOrder', 'DRAFT', 'SUBMITTED', 'po1');
    expect(r).toEqual({ gated: true, approvalInstanceId: 'new-inst' });
    expect(repo.createInstance).toHaveBeenCalled();
  });
});

describe('CommandGovernanceService.gateStateTransition — decision snapshot (ADR-022 CONST-DOA-005)', () => {
  it('passes the document amount through to the resolver for band selection', async () => {
    const { svc, triggerResolver } = build();
    triggerResolver.resolveForStateTransition.mockResolvedValue(null);
    const amount = new Decimal(5000);

    await svc.gateStateTransition(identity, 'PurchaseOrder', 'DRAFT', 'SUBMITTED', 'po1', amount);

    expect(triggerResolver.resolveForStateTransition).toHaveBeenCalledWith(
      'o1',
      'PurchaseOrder',
      'DRAFT',
      'SUBMITTED',
      amount,
    );
  });

  it('records the evaluated amount and the matched band on the new instance', async () => {
    const { svc, triggerResolver, repo } = build();
    triggerResolver.resolveForStateTransition.mockResolvedValue({
      id: 'bind-mid',
      workflowDefinitionId: 'wd1',
      priority: 20,
      minAmount: new Decimal(1000),
      maxAmount: new Decimal(50000),
      definition: { transactionType: 'PURCHASE_ORDER' },
    });
    repo.findLatestInstanceForTransaction.mockResolvedValue(null);

    await svc.gateStateTransition(identity, 'PurchaseOrder', 'DRAFT', 'SUBMITTED', 'po1', new Decimal(5000));

    expect(repo.createInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedPolicyId: 'bind-mid',
        evaluatedAmount: expect.anything(),
        conditionSnapshot: expect.objectContaining({
          bindingId: 'bind-mid',
          banded: true,
          minAmount: '1000',
          maxAmount: '50000',
          evaluatedAmount: '5000',
        }),
      }),
    );
  });
});
