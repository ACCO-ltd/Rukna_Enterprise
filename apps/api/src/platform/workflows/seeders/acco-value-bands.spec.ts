import { Decimal } from '@prisma/client/runtime/library';

import {
  accoPurchaseOrderBands,
  accoSupplierPaymentBands,
  ACCO_ROLES,
  type ValueBand,
} from './acco-value-bands.js';
import { WorkflowTriggerResolverService } from '../application/workflow-trigger-resolver.service.js';

/**
 * ADR-022 CONST-DOA-005 — the seeded ACCO value bands must (a) be a clean partition of the amount
 * axis and (b) route through the Phase-2 resolver exactly as the authority matrix specifies. This
 * spec exercises the *real* band config (not fixtures), so a mis-seeded threshold or a gap between
 * bands fails here.
 */
describe('ACCO value bands (ADR-022 CONST-DOA-005)', () => {
  describe.each([
    ['Purchase Orders', accoPurchaseOrderBands()],
    ['Supplier Payments', accoSupplierPaymentBands()],
  ])('%s — the bands partition the amount axis', (_label, bands: ValueBand[]) => {
    it('starts at the floor and ends unbounded', () => {
      expect(bands[0].minAmount).toBeNull();
      expect(bands[bands.length - 1].maxAmount).toBeNull();
    });

    it('is contiguous with no gaps or overlaps (each max is the next min)', () => {
      for (let i = 0; i < bands.length - 1; i++) {
        expect(bands[i].maxAmount).toBe(bands[i + 1].minAmount);
      }
    });

    it('every band has a non-empty, cumulative approver chain', () => {
      for (let i = 0; i < bands.length; i++) {
        expect(bands[i].steps.length).toBeGreaterThan(0);
        // Cumulative: a higher band never drops an approver the band below required.
        if (i > 0) {
          for (const role of bands[i - 1].steps) {
            expect(bands[i].steps).toContain(role);
          }
        }
      }
    });
  });

  it('encodes the CONST-DOA-005 PO thresholds and authorities', () => {
    const bands = accoPurchaseOrderBands();
    expect(bands.map((b) => [b.minAmount, b.maxAmount])).toEqual([
      [null, '100.01'],
      ['100.01', '1000.01'],
      ['1000.01', '50000.01'],
      ['50000.01', null],
    ]);
    // > $50,000 is the only band that pulls in the CEO (ACCO 2026-08-22: no Board Chairman tier).
    expect(bands[3].steps).toEqual([
      ACCO_ROLES.CONSTRUCTION_DIRECTOR,
      ACCO_ROLES.FINANCE_OFFICER,
      ACCO_ROLES.CFO,
      ACCO_ROLES.CEO,
    ]);
  });

  it('encodes the CONST-DOA-005 payment thresholds ($1k and $10k)', () => {
    const bands = accoSupplierPaymentBands();
    expect(bands.map((b) => [b.minAmount, b.maxAmount])).toEqual([
      [null, '1000.01'],
      ['1000.01', '10000.01'],
      ['10000.01', null],
    ]);
    expect(bands[2].steps).toEqual([ACCO_ROLES.FINANCE_OFFICER, ACCO_ROLES.CFO, ACCO_ROLES.CEO]);
  });

  describe('routing the real bands through the Phase-2 resolver', () => {
    // Build the STATE_TRANSITION bindings the seeder would create for one band set.
    function bindingsFor(entityType: string, toState: string, bands: ValueBand[]) {
      return bands.map((band, i) => ({
        id: `bind-${i}`,
        organizationId: 'o1',
        triggerKind: 'STATE_TRANSITION',
        entityType,
        fromState: 'DRAFT',
        toState,
        transactionType: entityType === 'PurchaseOrder' ? 'PURCHASE_ORDER' : 'SUPPLIER_PAYMENT',
        workflowDefinitionId: `def-${i}`,
        priority: 50,
        minAmount: band.minAmount === null ? null : new Decimal(band.minAmount),
        maxAmount: band.maxAmount === null ? null : new Decimal(band.maxAmount),
        isActive: true,
        definition: { id: `def-${i}`, name: band.name },
      }));
    }

    function resolverWith(bindings: unknown[]) {
      const prisma = {
        workflowRequirementPolicy: { findMany: jest.fn().mockResolvedValue([]) },
        workflowTriggerBinding: { findMany: jest.fn().mockResolvedValue(bindings) },
      };
      return new WorkflowTriggerResolverService({ getClient: () => prisma } as never);
    }

    it.each([
      [50, 'PO ≤ $100'],
      [100, 'PO ≤ $100'],
      [500, 'PO $100.01–$1,000'],
      [5000, 'PO $1,000.01–$50,000'],
      [50000, 'PO $1,000.01–$50,000'],
      [100000, 'PO > $50,000'],
    ])('a $%d PO routes to "%s"', async (amount, expectedName) => {
      const svc = resolverWith(bindingsFor('PurchaseOrder', 'SUBMITTED', accoPurchaseOrderBands()));
      const binding = await svc.resolveForStateTransition(
        'o1',
        'PurchaseOrder',
        'DRAFT',
        'SUBMITTED',
        new Decimal(amount),
      );
      expect(binding?.definition.name).toBe(expectedName);
    });

    it.each([
      [500, 'Payment ≤ $1,000'],
      [5000, 'Payment $1,000.01–$10,000'],
      [50000, 'Payment > $10,000'],
    ])('a $%d payment routes to "%s"', async (amount, expectedName) => {
      const svc = resolverWith(bindingsFor('SupplierPayment', 'APPROVED', accoSupplierPaymentBands()));
      const binding = await svc.resolveForStateTransition(
        'o1',
        'SupplierPayment',
        'DRAFT',
        'APPROVED',
        new Decimal(amount),
      );
      expect(binding?.definition.name).toBe(expectedName);
    });
  });
});
