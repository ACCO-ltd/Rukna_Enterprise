import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ExtraWorkClassifierService } from './extra-work-classifier.service.js';

/**
 * The R5 extra-work classifier orchestration (ADR-029 CONST-BOQ-029 / spec E-1..E-4). DB-free: the
 * BoqTreeService and VariationOrderService dependencies are mocked, so what is under test is the
 * dispatch + per-branch authorization + the exact call each treatment fans to. Each branch's *effect*
 * on the in-contract total / contingency / whether BOQ nodes land now (E-4) is asserted through which
 * dependency it calls: ABSORB → addAbsorbedScope (net-zero, nodes now), SEPARATE → addSeparateChargeLine
 * (excluded from total, nodes now), VARIATION → VariationOrderService.create (NO nodes, DRAFT VO).
 */

function identityWith(...permissions: string[]): RequestIdentity {
  return { userId: 'u1', activeOrganizationId: 'o1', permissions } as never;
}

function build() {
  const boqTree = {
    getOperationalVersionId: jest.fn().mockResolvedValue('v1'),
    addAbsorbedScope: jest.fn().mockResolvedValue({ id: 'absorbed' }),
    addSeparateChargeLine: jest.fn().mockResolvedValue({ id: 'separate' }),
  };
  const variationOrders = {
    create: jest.fn().mockResolvedValue({ id: 'vo1', reference: 'VO-001', status: 'DRAFT' }),
  };
  const svc = new ExtraWorkClassifierService(boqTree as never, variationOrders as never);
  return { svc, boqTree, variationOrders };
}

describe('ExtraWorkClassifierService.addExtraWork — ADR-029 E-1..E-4', () => {
  // ─── E-1 ABSORB ───────────────────────────────────────────────────────────────
  describe('ABSORB (E-1)', () => {
    it('adds an ABSORBED leaf per line via addAbsorbedScope and NEVER touches the VO create', async () => {
      const { svc, boqTree, variationOrders } = build();
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
      expect(variationOrders.create).not.toHaveBeenCalled();
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
    it('adds a SEPARATE_CHARGE leaf per line via addSeparateChargeLine (nodes land now)', async () => {
      const { svc, boqTree, variationOrders } = build();
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
      expect(variationOrders.create).not.toHaveBeenCalled();
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
  describe('VARIATION (E-2)', () => {
    it('creates a DRAFT VariationOrder from the lines and adds NO BOQ nodes', async () => {
      const { svc, boqTree, variationOrders } = build();
      const result = await svc.addExtraWork(identityWith(PERMISSIONS.contractsManage), 'p1', {
        treatment: 'VARIATION',
        contractId: 'c1',
        variationTitle: 'Extra excavation',
        lines: [{ description: 'Rock excavation', amount: '3000.00' }],
      });

      expect(variationOrders.create).toHaveBeenCalledTimes(1);
      expect(variationOrders.create).toHaveBeenCalledWith(expect.anything(), 'c1', {
        title: 'Extra excavation',
        lines: [{ description: 'Rock excavation', quantity: 1, unitRate: 3000 }],
      });
      // No BOQ nodes are materialized on VARIATION (that is adopt/R6).
      expect(boqTree.addAbsorbedScope).not.toHaveBeenCalled();
      expect(boqTree.addSeparateChargeLine).not.toHaveBeenCalled();
      expect(boqTree.getOperationalVersionId).not.toHaveBeenCalled();
      expect(result).toMatchObject({ treatment: 'VARIATION', variation: { id: 'vo1' } });
    });

    it('rejects VARIATION without a contractId (a project may have several contracts)', async () => {
      const { svc, variationOrders } = build();
      await expect(
        svc.addExtraWork(identityWith(PERMISSIONS.contractsManage), 'p1', {
          treatment: 'VARIATION',
          lines: [{ description: 'x', amount: '10.00' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(variationOrders.create).not.toHaveBeenCalled();
    });

    it('requires contractsManage (403 without it)', async () => {
      const { svc, variationOrders } = build();
      await expect(
        svc.addExtraWork(identityWith(PERMISSIONS.boqManage), 'p1', {
          treatment: 'VARIATION',
          contractId: 'c1',
          lines: [{ description: 'x', amount: '10.00' }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(variationOrders.create).not.toHaveBeenCalled();
    });
  });
});
