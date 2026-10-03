import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@erp/types';

import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/decorators/require-permissions.decorator.js';
import { PurchaseOrderController } from './purchase-order.controller.js';
import { SettlementQueryService } from '../application/settlement-query.service.js';

/**
 * ADR-043 decision 4 — the Procurement Manager sees supplier-bill payment status WITH amounts, on a
 * permission the role already holds; money-blind roles (Project Manager, Site Engineer) do not.
 */

/** The permission keys (PERMISSIONS.<key>) a role is granted in the ACCO team seed. */
function seededPermissions(roleName: string): Set<string> {
  const seed = readFileSync(join(__dirname, '../../../../../prisma/seeds/acco-team-roles.seed.ts'), 'utf8');
  const start = seed.indexOf(`name: '${roleName}'`);
  expect(start).toBeGreaterThan(-1);
  const end = seed.indexOf('\n  },', start);
  return new Set([...seed.slice(start, end).matchAll(/P\.(\w+)/g)].map((m) => m[1]));
}

describe('PO money reads (bill-payments, settlement) — gate', () => {
  const required = Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    PurchaseOrderController.prototype.getBillPayments,
  ) as string[];

  it('requires view:procurement AND view:commitment-ledger', () => {
    expect(required).toEqual([PERMISSIONS.procurementView, PERMISSIONS.commitmentsView]);
  });

  it('the settlement read (money) has the same gate; receiving (no money) keeps the class gate', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PurchaseOrderController.prototype.getSettlement),
    ).toEqual([PERMISSIONS.procurementView, PERMISSIONS.commitmentsView]);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PurchaseOrderController.prototype.getReceiving)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PurchaseOrderController)).toEqual([PERMISSIONS.procurementView]);
  });

  it.each(['Finance Officer', 'Construction Director'])('%s holds both gates', (role) => {
    const perms = seededPermissions(role);
    expect(perms.has('procurementView') && perms.has('commitmentsView')).toBe(true);
  });

  it('the Procurement Manager already holds both — no role-grant change', () => {
    const pm = seededPermissions('Procurement Manager');
    expect(pm.has('procurementView')).toBe(true);
    expect(pm.has('commitmentsView')).toBe(true);
  });

  it.each(['Project Manager', 'Site Engineer'])('%s stays blind (no view:commitment-ledger)', (role) => {
    expect(seededPermissions(role).has('commitmentsView')).toBe(false);
  });
});

describe('SettlementQueryService.getBillPayments', () => {
  const identity = { userId: 'u', activeOrganizationId: 'o', roles: [], permissions: [] } as never;
  function build(exists: boolean, bills: unknown[], member = true) {
    const repo = {
      purchaseOrderExists: jest.fn().mockResolvedValue(exists),
      findPoProjectIds: jest.fn().mockResolvedValue(['prj-1']),
      findBillPaymentsForPo: jest.fn().mockResolvedValue(bills),
      findPoForSettlement: jest.fn(),
    };
    const projectAccess = {
      accessibleProjectIds: jest.fn().mockResolvedValue(member ? undefined : []),
      assertMember: jest.fn(async () => {
        if (!member) throw new ForbiddenException('You are not a member of this project.');
      }),
    };
    return new SettlementQueryService({ getClient: () => ({}) } as never, repo as never, projectAccess as never);
  }

  it('member of ONE of two projects on the PO: receiving allowed, settlement and bill payments refused', async () => {
    const repo = {
      purchaseOrderExists: jest.fn().mockResolvedValue(true),
      findPoProjectIds: jest.fn().mockResolvedValue(['prj-1', 'prj-2']),
      findBillPaymentsForPo: jest.fn().mockResolvedValue([]),
      findPoForSettlement: jest.fn().mockResolvedValue({ revisions: [{ status: 'ACTIVE', lines: [] }] }),
      receivedByPoLine: jest.fn().mockResolvedValue({ byLine: new Map(), hasOverReceipt: false }),
    };
    const projectAccess = {
      accessibleProjectIds: jest.fn().mockResolvedValue(['prj-1']),
      assertMember: jest.fn(async (_i: unknown, projectId: string) => {
        if (projectId !== 'prj-1') throw new ForbiddenException('You are not a member of this project.');
      }),
    };
    const svc = new SettlementQueryService({ getClient: () => ({}) } as never, repo as never, projectAccess as never);
    await expect(svc.getReceiving(identity, 'po')).resolves.toMatchObject({ receivingStatus: 'RECEIVED', receivingLines: [] });
    await expect(svc.getSettlementForViewer(identity, 'po')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getBillPayments(identity, 'po')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('receiving: an org-level PO (no project lines) needs no membership; a member of none is refused', async () => {
    const make = (projects: string[]) =>
      new SettlementQueryService(
        { getClient: () => ({}) } as never,
        {
          purchaseOrderExists: jest.fn().mockResolvedValue(true),
          findPoProjectIds: jest.fn().mockResolvedValue(projects),
          findPoForSettlement: jest.fn().mockResolvedValue({ revisions: [] }),
          receivedByPoLine: jest.fn().mockResolvedValue({ byLine: new Map(), hasOverReceipt: false }),
        } as never,
        { accessibleProjectIds: jest.fn().mockResolvedValue(['other']), assertMember: jest.fn() } as never,
      );
    await expect(make([]).getReceiving(identity, 'po')).resolves.toBeDefined();
    await expect(make(['prj-1']).getReceiving(identity, 'po')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a non-member of a project the PO is coded to is refused (bill payments, settlement, receiving)', async () => {
    const svc = build(true, [], false);
    await expect(svc.getBillPayments(identity, 'po')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getSettlementForViewer(identity, 'po')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getReceiving(identity, 'po')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 for a PO outside the organisation', async () => {
    await expect(build(false, []).getBillPayments(identity, 'po')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('paid / pending / outstanding / last payment date / status per bill', async () => {
    const svc = build(true, [
      {
        id: 'b1',
        billNumber: 'BILL-1',
        supplierInvoiceNumber: 'INV-9',
        billDate: new Date('2026-09-01'),
        dueDate: new Date('2026-10-01'),
        currencyCode: 'USD',
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        totalAmount: '1000',
        outstandingAmount: '200',
        allocations: [
          { allocatedAmount: '600', postingStatus: 'POSTED', supplierPaymentId: 'p1', payment: { paymentDate: new Date('2026-09-15') } },
          { allocatedAmount: '200', postingStatus: 'NOT_POSTED', supplierPaymentId: 'p2', payment: { paymentDate: new Date('2026-09-30') } },
        ],
      },
    ]);
    const res = await svc.getBillPayments(identity, 'po');
    expect(res.bills[0]).toMatchObject({
      billNumber: 'BILL-1',
      totalAmount: '1000.00',
      paidAmount: '600.00',
      pendingAmount: '200.00',
      outstandingAmount: '200.00',
      lastPaymentDate: '2026-09-15',
      paymentStatus: 'PARTIALLY_PAID',
    });
  });
});
