import { ConflictException } from '@nestjs/common';

import { SupplierBillService } from './supplier-bill.service.js';
import { SupplierPaymentService } from './supplier-payment.service.js';

/**
 * ADR-011: SupplierBill.submit (DRAFT→SUBMITTED) and SupplierPayment.approve
 * (DRAFT→APPROVED — the payment has no separate submit) participate in the same
 * gateStateTransition seam. Backward-compatible: null gate → transition proceeds.
 */
const identity = {
  userId: 'u1',
  activeOrganizationId: 'o1',
  roles: [],
  permissions: [],
} as never;

describe('AP governance seam (ADR-011)', () => {
  describe('SupplierBillService.submit', () => {
    function build(gate: unknown) {
      const prisma = {
        supplierBill: {
          findFirst: jest.fn().mockResolvedValue({ id: 'b1', documentStatus: 'DRAFT' }),
          update: jest.fn().mockResolvedValue({ id: 'b1', documentStatus: 'SUBMITTED' }),
        },
      };
      const tenancy = { getClient: () => prisma } as never;
      const commandGovernance = { gateStateTransition: jest.fn().mockResolvedValue(gate) };
      const sod = { assertAllowed: jest.fn() };
      const svc = new SupplierBillService(
        tenancy,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        commandGovernance as never,
        sod as never,
      );
      return { svc, prisma, commandGovernance };
    }

    it('gates with 409 when a binding resolves, without changing state', async () => {
      const { svc, prisma, commandGovernance } = build({ gated: true, approvalInstanceId: 'ai-1' });
      await expect(svc.submit(identity, 'b1')).rejects.toBeInstanceOf(ConflictException);
      expect(commandGovernance.gateStateTransition).toHaveBeenCalledWith(
        identity,
        'SupplierBill',
        'DRAFT',
        'SUBMITTED',
        'b1',
      );
      expect(prisma.supplierBill.update).not.toHaveBeenCalled();
    });

    it('proceeds when no binding is configured (gate returns null)', async () => {
      const { svc, prisma } = build(null);
      await svc.submit(identity, 'b1');
      expect(prisma.supplierBill.update).toHaveBeenCalled();
    });
  });

  describe('SupplierPaymentService.approve', () => {
    function build(gate: unknown) {
      // approve() walks the payment's bill allocations for the SoD check (ADR-022) before the gate.
      const prisma = {
        supplierPaymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const tenancy = { getClient: () => prisma } as never;
      const paymentRepo = {
        findById: jest.fn().mockResolvedValue({ id: 'p1', documentStatus: 'DRAFT', totalAmount: 500 }),
        approve: jest.fn().mockResolvedValue({ id: 'p1', documentStatus: 'APPROVED' }),
      };
      const commandGovernance = { gateStateTransition: jest.fn().mockResolvedValue(gate) };
      const sod = { assertAllowed: jest.fn() };
      const svc = new SupplierPaymentService(
        tenancy,
        paymentRepo as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        commandGovernance as never,
        sod as never,
        {} as never,
      );
      return { svc, paymentRepo, commandGovernance };
    }

    it('gates with 409 when a binding resolves, without changing state', async () => {
      const { svc, paymentRepo, commandGovernance } = build({ gated: true, approvalInstanceId: 'ai-2' });
      await expect(svc.approve(identity, 'p1')).rejects.toBeInstanceOf(ConflictException);
      expect(commandGovernance.gateStateTransition).toHaveBeenCalledWith(
        identity,
        'SupplierPayment',
        'DRAFT',
        'APPROVED',
        'p1',
        // ADR-022 CONST-DOA-005: the payment value is passed for band routing.
        expect.anything(),
      );
      expect(paymentRepo.approve).not.toHaveBeenCalled();
    });

    it('proceeds when no binding is configured (gate returns null)', async () => {
      const { svc, paymentRepo } = build(null);
      await svc.approve(identity, 'p1');
      expect(paymentRepo.approve).toHaveBeenCalled();
    });
  });
});
