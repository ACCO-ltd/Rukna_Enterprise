import { ConflictException } from '@nestjs/common';

import { PurchaseOrderService } from './purchase-order.service.js';

/**
 * ADR-011: PO submission participates in the governance seam via gateStateTransition,
 * the same one IPA/Project use. Adding the call site is backward-compatible — with no
 * binding configured the gate returns null and submission proceeds unchanged.
 */
const identity = {
  userId: 'u1',
  activeOrganizationId: 'o1',
  roles: [],
  permissions: [],
} as never;

function build(gateResult: unknown) {
  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;
  const repo = {
    findById: jest.fn().mockResolvedValue({ id: 'po1', revisions: [{ id: 'rev1', status: 'DRAFT' }] }),
    updateRevisionStatus: jest.fn().mockResolvedValue(undefined),
  };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
  const commandGovernance = { gateStateTransition: jest.fn().mockResolvedValue(gateResult) };
  const svc = new PurchaseOrderService(
    tenancy,
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    auditOutbox as never,
    commandGovernance as never,
  );
  return { svc, repo, commandGovernance };
}

describe('PurchaseOrderService.submit — governance seam (ADR-011)', () => {
  it('gates submission (409 + approvalInstanceId) when a binding resolves, without changing state', async () => {
    const { svc, repo, commandGovernance } = build({ gated: true, approvalInstanceId: 'ai-1' });

    await expect(svc.submit(identity, 'po1')).rejects.toBeInstanceOf(ConflictException);

    expect(commandGovernance.gateStateTransition).toHaveBeenCalledWith(
      identity,
      'PurchaseOrder',
      'DRAFT',
      'SUBMITTED',
      'po1',
    );
    expect(repo.updateRevisionStatus).not.toHaveBeenCalled();

    // The 409 body carries the approval instance id (under details, so the global filter
    // forwards it) for the client to drive the approval + re-drive.
    try {
      await svc.submit(identity, 'po1');
    } catch (e) {
      expect((e as ConflictException).getResponse()).toMatchObject({
        details: { approvalInstanceId: 'ai-1' },
      });
    }
  });

  it('proceeds unchanged when no binding is configured (gate returns null)', async () => {
    const { svc, repo } = build(null);

    await svc.submit(identity, 'po1');

    expect(repo.updateRevisionStatus).toHaveBeenCalledWith(expect.anything(), 'rev1', 'SUBMITTED');
  });
});
