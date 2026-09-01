import { BadRequestException, NotFoundException } from '@nestjs/common';

import { SupplierService } from './supplier.service.js';

/**
 * A15 (D8): editable supplier master data via PATCH /suppliers/:id.
 * Master-data corrections (name / tax number / default currency / payment terms / address)
 * are permission-gated (enforced by the controller guard) and audited. The supplier's
 * code/identity and status are NOT editable here, and no historical facts on issued
 * POs/bills are rewritten (they reference the supplier by FK — nothing is snapshotted).
 */

const identity = {
  userId: 'u1',
  activeOrganizationId: 'o1',
  tenantSlug: 't1',
  roles: [],
  permissions: [],
} as never;

const EXISTING = {
  id: 's1',
  organizationId: 'o1',
  code: 'SUP-001',
  name: 'Old Name',
  taxNumber: '111',
  defaultCurrency: 'USD',
  paymentTermsDays: 30,
  address: null as string | null,
  status: 'ACTIVE',
};

function build(existing: typeof EXISTING | null = EXISTING) {
  const supplier = {
    findFirst: jest.fn().mockResolvedValue(existing),
    update: jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ ...EXISTING, ...data, id: where.id })),
  };
  const prisma = {
    supplier,
    // $transaction executes the callback with the same client (single-connection test double).
    $transaction: jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  const tenancy = { getClient: () => prisma } as never;
  const repo = {
    findById: (p: typeof prisma, orgId: string, id: string) =>
      p.supplier.findFirst({ where: { id, organizationId: orgId } }),
    update: (p: typeof prisma, id: string, data: Record<string, unknown>) =>
      p.supplier.update({ where: { id }, data }),
  } as never;
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupplierService(tenancy, repo, auditOutbox as never);
  return { svc, prisma, supplier, auditOutbox };
}

describe('SupplierService.update (A15 / D8)', () => {
  it('updates name/tax/currency/terms/address on the master record', async () => {
    const { svc, supplier } = build();
    const result = await svc.update(identity, 's1', {
      name: 'New Name',
      taxNumber: '999',
      defaultCurrency: 'SAR',
      paymentTermsDays: 45,
      address: 'King Fahd Rd, Riyadh',
    });

    expect(supplier.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        name: 'New Name',
        taxNumber: '999',
        defaultCurrency: 'SAR',
        paymentTermsDays: 45,
        address: 'King Fahd Rd, Riyadh',
      },
    });
    expect(result.name).toBe('New Name');
    expect(result.address).toBe('King Fahd Rd, Riyadh');
  });

  it('writes an audit + outbox event with before/after of the changed fields', async () => {
    const { svc, auditOutbox } = build();
    await svc.update(identity, 's1', { name: 'New Name' });

    expect(auditOutbox.record).toHaveBeenCalledTimes(1);
    const [tx, cmd] = auditOutbox.record.mock.calls[0];
    expect(tx).toBeDefined(); // recorded inside the same transaction as the mutation
    expect(cmd).toMatchObject({
      organizationId: 'o1',
      actorUserId: 'u1',
      action: 'UPDATE',
      resourceType: 'Supplier',
      resourceId: 's1',
      sourceCommand: 'supplier.update',
      eventType: 'SUPPLIER_MASTER_DATA_UPDATED',
      before: { name: 'Old Name' },
      after: { name: 'New Name' },
    });
  });

  it('is org-scoped: another org’s supplier resolves to 404 and is not touched', async () => {
    // Repo.findById filters by organizationId, so a foreign supplier returns null.
    const { svc, supplier, auditOutbox } = build(null);
    await expect(svc.update(identity, 'foreign', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(supplier.update).not.toHaveBeenCalled();
    expect(auditOutbox.record).not.toHaveBeenCalled();
  });

  it('cannot change the supplier code/identity (extra fields are dropped, not written)', async () => {
    const { svc, supplier } = build();
    // `code` is not an editable field; a stray value must never reach the update payload.
    await svc.update(identity, 's1', { name: 'New Name', code: 'HACKED' } as never);

    const data = supplier.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('code');
    expect(data).not.toHaveProperty('status');
    expect(data).toEqual({ name: 'New Name' });
  });

  it('rejects an empty edit (no editable fields provided) before any DB work', async () => {
    const { svc, supplier, auditOutbox } = build();
    await expect(svc.update(identity, 's1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(supplier.findFirst).not.toHaveBeenCalled();
    expect(supplier.update).not.toHaveBeenCalled();
    expect(auditOutbox.record).not.toHaveBeenCalled();
  });
});
