import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ExtraWorkClassifierService } from './extra-work-classifier.service.js';

/**
 * The R5 extra-work classifier orchestration (ADR-029 CONST-BOQ-029 / spec E-1..E-4). DB-free: the
 * BoqTreeService / VariationOrderService / ApplyVariationToBoqService / ClientInvoiceService
 * dependencies are mocked, so what is under test is the dispatch + per-branch authorization + the exact
 * call each treatment fans to. variation-collapse changes two branches: SEPARATE now bills the client
 * NOW (ClientInvoiceService.generateFromSeparateCharge) and VARIATION now raises AND adopts in one step
 * (ApplyVariationToBoqService.raiseAndAdopt → the returned VO reads adopted), so:
 *   ABSORB → addAbsorbedScope (net-zero, nodes now, no invoice)
 *   SEPARATE → addSeparateChargeLine (excluded from total, nodes now) + generateFromSeparateCharge
 *   VARIATION → raiseAndAdopt (lands CLIENT_APPROVED + adopted; contract value raised), NOT create
 */

function identityWith(...permissions: string[]): RequestIdentity {
  return { userId: 'u1', activeOrganizationId: 'o1', permissions } as never;
}

function build() {
  const boqTree = {
    getOperationalVersionId: jest.fn().mockResolvedValue('v1'),
    addAbsorbedScope: jest.fn().mockResolvedValue({ id: 'absorbed' }),
    addSeparateChargeLine: jest.fn().mockResolvedValue({ id: 'separate-node' }),
  };
  const variationOrders = {
    create: jest.fn().mockResolvedValue({ id: 'vo1', reference: 'VO-001', status: 'DRAFT' }),
    // After adopt, findOne returns the CLIENT_APPROVED + adopted VO the classifier surfaces.
    findOne: jest.fn().mockResolvedValue({
      id: 'vo1',
      reference: 'VO-001',
      status: 'CLIENT_APPROVED',
      appliedToBoq: true,
      boqAppliedAt: '2026-09-17T00:00:00.000Z',
    }),
  };
  const applyToBoq = {
    raiseAndAdopt: jest.fn().mockResolvedValue({
      variationId: 'vo1',
      reference: 'VO-001',
      projectId: 'p1',
      boqVersionId: 'v-op',
      snapshotVersionId: 'v-snap',
      nodeCount: 1,
      newContractValue: '1003000.00',
      appliedAt: '2026-09-17T00:00:00.000Z',
    }),
  };
  const clientInvoices = {
    generateFromSeparateCharge: jest.fn().mockResolvedValue({ id: 'inv-1' }),
  };
  const contracts = {
    resolveActiveClientContract: jest.fn().mockResolvedValue({
      id: 'c1',
      contractNumber: 'ACCO-P1-C1',
    }),
  };
  const svc = new ExtraWorkClassifierService(
    boqTree as never,
    variationOrders as never,
    applyToBoq as never,
    clientInvoices as never,
    contracts as never,
  );
  return { svc, boqTree, variationOrders, applyToBoq, clientInvoices, contracts };
}

describe('ExtraWorkClassifierService.addExtraWork — ADR-029 E-1..E-4', () => {
  // ─── E-1 ABSORB ───────────────────────────────────────────────────────────────
  describe('ABSORB (E-1)', () => {
    it('adds an ABSORBED leaf per line via addAbsorbedScope and NEVER raises a variation or an invoice', async () => {
      const { svc, boqTree, applyToBoq, clientInvoices } = build();
      const result = await svc.addExtraWork(identityWith(PERMISSIONS.boqManageContingency), 'p1', {
        treatment: 'ABSORB',
        lines: [
          { description: 'Extra wall', amount: '200.00' },
          { description: 'Extra beam', amount: '50.00', unit: 'm' },
        ],
      });

      expect(boqTree.addAbsorbedScope).toHaveBeenCalledTimes(2);
      expect(boqTree.addAbsorbedScope).toHaveBeenCalledWith(expect.anything(), 'p1', 'v1', {
        description: 'Extra wall',
        amount: '200.00',
      });
      expect(applyToBoq.raiseAndAdopt).not.toHaveBeenCalled();
      expect(clientInvoices.generateFromSeparateCharge).not.toHaveBeenCalled();
      expect(result).toMatchObject({ treatment: 'ABSORB' });
    });

    it('requires manage-contingency:boq (403 without it)', async () => {
      const { svc, boqTree } = build();
      await expect(
        svc.addExtraWork(identityWith(PERMISSIONS.boqManage), 'p1', {
          treatment: 'ABSORB',
          lines: [{ description: 'x', amount: '10.00' }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(boqTree.addAbsorbedScope).not.toHaveBeenCalled();
    });
  });

  // ─── E-3 SEPARATE ───────────────────────────────────────────────────────────────
  describe('SEPARATE (E-3)', () => {
    it('adds a SEPARATE_CHARGE leaf per line AND bills the client now (contract value untouched)', async () => {
      const { svc, boqTree, applyToBoq, clientInvoices } = build();
      const result = await svc.addExtraWork(identityWith(PERMISSIONS.boqManage), 'p1', {
        treatment: 'SEPARATE',
        lines: [{ description: 'Signage', amount: '750.00', unit: 'LS' }],
      });

      expect(boqTree.addSeparateChargeLine).toHaveBeenCalledTimes(1);
      expect(boqTree.addSeparateChargeLine).toHaveBeenCalledWith(expect.anything(), 'p1', 'v1', {
        description: 'Signage',
        isLeaf: true,
        unit: 'LS',
        quantity: '1',
        unitRate: '750.00',
      });
      // variation-collapse: each SEPARATE node is billed immediately off its node id.
      expect(clientInvoices.generateFromSeparateCharge).toHaveBeenCalledTimes(1);
      expect(clientInvoices.generateFromSeparateCharge).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ boqNodeId: 'separate-node' }),
      );
      // A separate charge NEVER raises the contract value — no variation is adopted.
      expect(applyToBoq.raiseAndAdopt).not.toHaveBeenCalled();
      expect(result).toMatchObject({ treatment: 'SEPARATE' });
    });

    it('requires manage:boq (403 without it)', async () => {
      const { svc, boqTree } = build();
      await expect(
        svc.addExtraWork(identityWith(PERMISSIONS.boqManageContingency), 'p1', {
          treatment: 'SEPARATE',
          lines: [{ description: 'x', amount: '10.00' }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(boqTree.addSeparateChargeLine).not.toHaveBeenCalled();
    });
  });

  // ─── E-2 VARIATION ────────────────────────────────────────────────────────────
  describe('VARIATION (E-2, variation-collapse)', () => {
    it('raises AND adopts the variation in one step and returns the adopted VO (CLIENT_APPROVED + boqAppliedAt set)', async () => {
      const { svc, applyToBoq, variationOrders } = build();
      const result = await svc.addExtraWork(identityWith(PERMISSIONS.contractsManage), 'p1', {
        treatment: 'VARIATION',
        variationTitle: 'Extra excavation',
        clientApprovalReference: 'SIGNED-VO-9',
        lines: [{ description: 'Rock excavation', amount: '3000.00' }],
      });

      // The classifier no longer creates a DRAFT VO — it raises-and-adopts atomically.
      expect(applyToBoq.raiseAndAdopt).toHaveBeenCalledTimes(1);
      expect(applyToBoq.raiseAndAdopt).toHaveBeenCalledWith(expect.anything(), 'c1', {
        title: 'Extra excavation',
        lines: [{ description: 'Rock excavation', quantity: 1, unitRate: 3000 }],
        clientApprovalReference: 'SIGNED-VO-9',
      });
      // The surfaced VO reads as adopted (CLIENT_APPROVED + boqAppliedAt) via findOne.
      expect(variationOrders.findOne).toHaveBeenCalledWith(expect.anything(), 'vo1');
      expect(result).toMatchObject({
        treatment: 'VARIATION',
        variation: { id: 'vo1', status: 'CLIENT_APPROVED', appliedToBoq: true },
      });
      const adoptedVariation = (result as { variation: { boqAppliedAt: string | null } }).variation;
      expect(adoptedVariation.boqAppliedAt).not.toBeNull();
    });

    it('resolves the project active client contract without a browser-supplied contractId', async () => {
      const { svc, applyToBoq, contracts } = build();
      await svc.addExtraWork(identityWith(PERMISSIONS.contractsManage), 'p1', {
        treatment: 'VARIATION',
        lines: [{ description: 'x', amount: '10.00' }],
      });
      expect(contracts.resolveActiveClientContract).toHaveBeenCalledWith(expect.anything(), 'p1');
      expect(applyToBoq.raiseAndAdopt).toHaveBeenCalledWith(
        expect.anything(),
        'c1',
        expect.anything(),
      );
    });

    it('requires contractsManage (403 without it)', async () => {
      const { svc, applyToBoq } = build();
      await expect(
        svc.addExtraWork(identityWith(PERMISSIONS.boqManage), 'p1', {
          treatment: 'VARIATION',
          contractId: 'c1',
          lines: [{ description: 'x', amount: '10.00' }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(applyToBoq.raiseAndAdopt).not.toHaveBeenCalled();
    });
  });
});
