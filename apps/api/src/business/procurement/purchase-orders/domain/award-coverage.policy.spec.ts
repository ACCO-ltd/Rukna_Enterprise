import { Decimal } from '@prisma/client/runtime/library';

import { awardCoverage, type CoverageInput } from './award-coverage.policy.js';

/** ADR-044 §7 — each of the five coverage conditions failing alone. */
describe('award coverage policy', () => {
  const base = (): CoverageInput => ({
    award: {
      status: 'AWARDED',
      purchaseOrderId: 'po1',
      awardedSupplierId: 's1',
      awardedTotal: new Decimal('2295.00'),
      materialRequestLineIds: ['m1', 'm2'],
    },
    purchaseOrder: { id: 'po1', supplierId: 's1' },
    revisions: [{ status: 'DRAFT', approvedAt: null }],
    draftLines: [{ mrLineIds: ['m1'] }, { mrLineIds: ['m2'] }],
    draftTotal: new Decimal('2294.9990'),
  });

  it('covered when all five hold (draft total at or below the award)', () => {
    expect(awardCoverage(base())).toEqual({ kind: 'COVERED' });
    expect(awardCoverage({ ...base(), draftTotal: new Decimal('2295') })).toEqual({ kind: 'COVERED' });
  });

  it('1 — no request, not AWARDED, or linked to another PO → NOT_FROM_AWARD', () => {
    expect(awardCoverage({ ...base(), award: null })).toEqual({ kind: 'NOT_FROM_AWARD' });
    expect(awardCoverage({ ...base(), award: { ...base().award!, status: 'CANCELLED' } })).toEqual({ kind: 'NOT_FROM_AWARD' });
    expect(awardCoverage({ ...base(), award: { ...base().award!, purchaseOrderId: 'po2' } })).toEqual({
      kind: 'NOT_FROM_AWARD',
    });
  });

  it('2 — a revision was ever confirmed (amendment) → NOT_COVERED', () => {
    expect(
      awardCoverage({
        ...base(),
        revisions: [
          { status: 'ACTIVE', approvedAt: new Date() },
          { status: 'DRAFT', approvedAt: null },
        ],
      }),
    ).toEqual({ kind: 'NOT_COVERED', reason: 'AMENDMENT' });
    expect(
      awardCoverage({ ...base(), revisions: [{ status: 'CANCELLED', approvedAt: new Date() }, { status: 'DRAFT', approvedAt: null }] }),
    ).toEqual({ kind: 'NOT_COVERED', reason: 'AMENDMENT' });
  });

  it('3 — supplier swapped → NOT_COVERED', () => {
    expect(awardCoverage({ ...base(), purchaseOrder: { id: 'po1', supplierId: 's2' } })).toEqual({
      kind: 'NOT_COVERED',
      reason: 'SUPPLIER_CHANGED',
    });
  });

  it('4 — a foreign or unallocated line → NOT_COVERED', () => {
    expect(awardCoverage({ ...base(), draftLines: [{ mrLineIds: ['m1'] }, { mrLineIds: ['zz'] }] })).toEqual({
      kind: 'NOT_COVERED',
      reason: 'FOREIGN_LINES',
    });
    expect(awardCoverage({ ...base(), draftLines: [{ mrLineIds: [] }] })).toEqual({
      kind: 'NOT_COVERED',
      reason: 'FOREIGN_LINES',
    });
  });

  it('5 — draft total above the award → EXCEEDS_AWARD', () => {
    expect(awardCoverage({ ...base(), draftTotal: new Decimal('2295.0001') })).toEqual({ kind: 'EXCEEDS_AWARD' });
  });
});
