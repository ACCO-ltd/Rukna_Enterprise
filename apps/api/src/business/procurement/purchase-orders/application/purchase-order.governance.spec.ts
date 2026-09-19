import { ConflictException, NotFoundException } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service.js';

// PO no longer has a governance gate — confirm() is a single-actor direct action.
// These unit tests verify the guard clauses on confirm().
const identity = {
  userId: 'u1',
  activeOrganizationId: 'o1',
  roles: [],
  permissions: [],
} as never;

function buildSvc(po: unknown) {
  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;
  const repo = {
    findById: jest.fn().mockResolvedValue(po),
    updateRevisionStatus: jest.fn().mockResolvedValue(undefined),
    updatePoStatus: jest.fn().mockResolvedValue(undefined),
  };
  const commitmentWriter = {
    queryByPoLineAndStage: jest.fn().mockResolvedValue([]),
    committed: jest.fn().mockResolvedValue(undefined),
  };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
  const attachmentRepo = { freezeRevisionAttachments: jest.fn().mockResolvedValue(undefined) };
  const svc = new PurchaseOrderService(
    tenancy,
    repo as never,
    attachmentRepo as never,
    {} as never,
    {} as never,
    commitmentWriter as never,
    auditOutbox as never,
    {} as never,
    { assertAllowed: jest.fn() } as never,
    {} as never, // settlementQueryService
  );
  return { svc, repo };
}

describe('PurchaseOrderService.confirm', () => {
  it('throws NotFoundException when PO does not exist', async () => {
    const { svc } = buildSvc(null);
    await expect(svc.confirm(identity, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException when no DRAFT revision exists', async () => {
    const { svc } = buildSvc({
      id: 'po1',
      organizationId: 'o1',
      supplierId: 's1',
      revisions: [{ id: 'rev1', status: 'ACTIVE', lines: [] }],
    });
    await expect(svc.confirm(identity, 'po1')).rejects.toBeInstanceOf(ConflictException);
  });
});
