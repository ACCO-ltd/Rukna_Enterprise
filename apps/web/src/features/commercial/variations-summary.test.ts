import { describe, expect, it } from 'vitest';
import type { VariationOrderListItem } from '@erp/types';

import { summariseVariations, variationKind } from './variations-summary';

function vo(overrides: Partial<VariationOrderListItem> = {}): VariationOrderListItem {
  return {
    id: 'vo-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status: 'DRAFT',
    title: 'Additional works',
    description: null,
    proposedTimeImpactDays: null,
    netPrice: '10000.00',
    lineCount: 1,
    atRiskAuthorisationCount: 0,
    atRiskExposure: '0.00',
    createdBy: 'u-1',
    submittedBy: null,
    submittedAt: null,
    internalApprovedBy: null,
    internalApprovedAt: null,
    clientApprovedBy: null,
    clientApprovedAt: null,
    clientApprovalReference: null,
    rejectedBy: null,
    rejectedAt: null,
    reason: null,
    appliedToBoq: false,
    boqNodeCount: 0,
    boqAppliedAt: null,
    boqAppliedVersionId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('variationKind', () => {
  /** CONST-VAR-002: an omission is a negative-amount variation, not a separate document type. */
  it('reads the sign of the net price rather than a document type', () => {
    expect(variationKind(vo({ netPrice: '10000.00' }))).toBe('VARIATION');
    expect(variationKind(vo({ netPrice: '-20000.00' }))).toBe('OMISSION');
  });

  it('calls a net-zero change neither', () => {
    expect(variationKind(vo({ netPrice: '0.00' }))).toBe('NEUTRAL');
  });
});

describe('summariseVariations', () => {
  it('counts only client-approved variations as approved', () => {
    const totals = summariseVariations([
      vo({ id: 'a', status: 'DRAFT' }),
      vo({ id: 'b', status: 'CLIENT_APPROVED' }),
      vo({ id: 'c', status: 'CLIENT_APPROVED' }),
      vo({ id: 'd', status: 'REJECTED' }),
      vo({ id: 'e', status: 'WITHDRAWN' }),
    ]);
    expect(totals.approvedCount).toBe(2);
    expect(totals.omissionCount).toBe(0);
  });

  /** Omissions are a signed subset of *approved* scope — a proposed omission is not yet a cut. */
  it('totals only client-approved omissions', () => {
    const totals = summariseVariations([
      vo({ id: 'a', status: 'CLIENT_APPROVED', netPrice: '-20000.00' }),
      vo({ id: 'b', status: 'CLIENT_APPROVED', netPrice: '-5000.50' }),
      vo({ id: 'c', status: 'CLIENT_APPROVED', netPrice: '80000.00' }),
      vo({ id: 'd', status: 'INTERNAL_APPROVED', netPrice: '-99000.00' }),
    ]);
    expect(totals.omissionCount).toBe(2);
    expect(totals.omissionsTotal).toBe('-25000.50');
    expect(totals.approvedCount).toBe(3);
  });

  /** Summed in cents, so a column of decimals cannot drift into `-25000.499999`. */
  it('sums money without float drift', () => {
    const totals = summariseVariations(
      Array.from({ length: 3 }, (_, i) =>
        vo({ id: `x-${i}`, status: 'CLIENT_APPROVED', netPrice: '-0.10' }),
      ),
    );
    expect(totals.omissionsTotal).toBe('-0.30');
  });
});
