import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { SupplierBillDocumentService } from './supplier-bill-document.service.js';

/**
 * ADR-036 read models for the supplier bill page: approval chain, history, payments.
 * Unit-level: Prisma and the platform readers are doubles; the DB-backed behaviour of the
 * readers themselves is covered by their own queries being plain `findMany`s.
 */

const identity = {
  userId: 'u-viewer',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
} as never;

const BILL = {
  id: 'bill-1',
  organizationId: 'org-1',
  createdBy: 'u-clerk',
  createdAt: new Date('2026-09-14T10:05:00Z'),
  approvedBy: 'u-fm',
  approvedAt: new Date('2026-09-15T09:12:00Z'),
};

function build(opts: {
  bill?: typeof BILL | null;
  chains?: unknown[];
  audited?: unknown[];
  allocations?: unknown[];
} = {}) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'u-clerk', firstName: 'Faarax', lastName: 'Nuur', email: 'f@acco.so' },
        { id: 'u-fm', firstName: 'Hodan', lastName: 'Abdi', email: 'h@acco.so' },
      ]),
    },
  };
  const tenancy = { getClient: () => prisma } as never;
  const repo = {
    findById: jest.fn().mockResolvedValue(opts.bill === undefined ? BILL : opts.bill),
    findAllocationsForBill: jest.fn().mockResolvedValue(opts.allocations ?? []),
  };
  const approvalHistory = { forTransaction: jest.fn().mockResolvedValue(opts.chains ?? []) };
  const recordActivity = { forRecords: jest.fn().mockResolvedValue(opts.audited ?? []) };
  const svc = new SupplierBillDocumentService(
    tenancy,
    repo as never,
    approvalHistory as never,
    recordActivity as never,
    { requiresDualControl: jest.fn().mockResolvedValue(false) } as never,
  );
  return { svc, repo, approvalHistory, recordActivity };
}

describe('SupplierBillDocumentService', () => {
  it('404s a bill outside the caller’s organisation before reading anything related', async () => {
    const { svc, approvalHistory, recordActivity, repo } = build({ bill: null });
    await expect(svc.approvals(identity, 'bill-x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.activity(identity, 'bill-x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.payments(identity, 'bill-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findById).toHaveBeenCalledWith(expect.anything(), 'org-1', 'bill-x');
    expect(approvalHistory.forTransaction).not.toHaveBeenCalled();
    expect(recordActivity.forRecords).not.toHaveBeenCalled();
    expect(repo.findAllocationsForBill).not.toHaveBeenCalled();
  });

  describe('approvals', () => {
    it('reports a direct approval when no chain was raised', async () => {
      const { svc } = build();
      const view = await svc.approvals(identity, 'bill-1');
      expect(view.instances).toEqual([]);
      expect(view.directApproval).toEqual({
        actor: { id: 'u-fm', name: 'Hodan Abdi' },
        at: '2026-09-15T09:12:00.000Z',
      });
    });

    it('returns the chain and no direct approval when a policy applied', async () => {
      const chain = { id: 'ai-1', steps: [] };
      const { svc, approvalHistory } = build({ chains: [chain] });
      const view = await svc.approvals(identity, 'bill-1');
      expect(approvalHistory.forTransaction).toHaveBeenCalledWith('org-1', 'SUPPLIER_BILL', 'bill-1');
      expect(view).toEqual({ instances: [chain], directApproval: null });
    });

    it('reports nothing for a bill not yet approved', async () => {
      const { svc } = build({ bill: { ...BILL, approvedBy: null as never, approvedAt: null as never } });
      expect((await svc.approvals(identity, 'bill-1')).directApproval).toBeNull();
    });
  });

  describe('activity', () => {
    it('merges audited commands, approval decisions and creation, newest first', async () => {
      const { svc } = build({
        audited: [
          { id: 'a-2', at: '2026-09-16T10:42:00.000Z', actor: { id: 'u-fm', name: 'Hodan Abdi' }, code: 'bills.post' },
          { id: 'a-1', at: '2026-09-14T10:20:00.000Z', actor: { id: 'u-clerk', name: 'Faarax Nuur' }, code: 'bills.submit' },
        ],
        chains: [
          {
            id: 'ai-1',
            steps: [
              { stepOrder: 1, roleRequired: 'FINANCE_MANAGER', state: 'APPROVED', actor: { id: 'u-fm', name: 'Hodan Abdi' }, actedAt: '2026-09-15T09:12:00.000Z' },
              { stepOrder: 2, roleRequired: 'COMMERCIAL_DIRECTOR', state: 'CURRENT', actor: null, actedAt: null },
            ],
          },
        ],
      });
      const entries = await svc.activity(identity, 'bill-1');
      expect(entries.map((e) => e.code)).toEqual(['bills.post', 'approval.approve', 'bills.submit', 'bills.create']);
      expect(entries[1]).toMatchObject({ detail: 'FINANCE_MANAGER', actor: { name: 'Hodan Abdi' } });
      expect(entries[3]).toMatchObject({ actor: { id: 'u-clerk', name: 'Faarax Nuur' }, at: '2026-09-14T10:05:00.000Z' });
    });

    it('records a rejection as a rejection', async () => {
      const { svc } = build({
        chains: [
          {
            id: 'ai-1',
            steps: [{ stepOrder: 1, roleRequired: 'FINANCE_MANAGER', state: 'REJECTED', actor: { id: 'u-fm', name: 'Hodan Abdi' }, actedAt: '2026-09-15T09:12:00.000Z' }],
          },
        ],
      });
      const entries = await svc.activity(identity, 'bill-1');
      expect(entries[0]!.code).toBe('approval.reject');
    });
  });

  describe('payments', () => {
    const allocation = (id: string, paymentId: string, amount: string, postingStatus: string) => ({
      id,
      supplierPaymentId: paymentId,
      allocatedAmount: new Decimal(amount),
      postingStatus,
      payment: { paymentNumber: `PAY-${paymentId}`, paymentDate: new Date('2026-09-20T00:00:00Z'), documentStatus: 'RELEASED' },
    });

    it('counts only posted allocations as paid, and reports unposted ones as pending', async () => {
      const { svc } = build({
        allocations: [
          allocation('al-1', 'p1', '1000.00', 'POSTED'),
          allocation('al-2', 'p1', '250.50', 'POSTED'),
          allocation('al-3', 'p2', '400.00', 'NOT_POSTED'),
          allocation('al-4', 'p3', '900.00', 'REVERSED'),
        ],
      });
      const view = await svc.payments(identity, 'bill-1');
      expect(view.paidAmount).toBe('1250.50');
      expect(view.pendingAmount).toBe('400.00');
      // Two posted allocations from one payment are one payment.
      expect(view.paymentCount).toBe(1);
      expect(view.allocations).toHaveLength(4);
      expect(view.allocations[0]).toMatchObject({
        paymentNumber: 'PAY-p1',
        paymentDate: '2026-09-20',
        allocatedAmount: '1000.00',
        postingStatus: 'POSTED',
      });
    });

    it('reports zero, not absence, for a bill nothing has paid', async () => {
      const { svc } = build();
      expect(await svc.payments(identity, 'bill-1')).toEqual({
        paidAmount: '0.00',
        pendingAmount: '0.00',
        paymentCount: 0,
        allocations: [],
      });
    });
  });
});
