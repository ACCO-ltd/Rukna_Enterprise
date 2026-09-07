import { describe, expect, it } from 'vitest';
import type { VariationOrderListItem } from '@erp/types';

import { summariseVariations, variationClientApproval, variationKind } from './variations-summary';

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

describe('variationClientApproval', () => {
  /**
   * Internal workflow state and the client's answer are two different facts. Only a variation
   * ACCO has internally approved is genuinely waiting on the client; anything earlier has not
   * reached them, and saying "pending client" there would point at the wrong desk.
   */
  it('separates the client answer from the internal state', () => {
    expect(variationClientApproval(vo({ status: 'DRAFT' }))).toBe('NOT_SUBMITTED');
    expect(variationClientApproval(vo({ status: 'PENDING_INTERNAL' }))).toBe('NOT_SUBMITTED');
    expect(variationClientApproval(vo({ status: 'INTERNAL_APPROVED' }))).toBe('PENDING');
    expect(variationClientApproval(vo({ status: 'CLIENT_APPROVED' }))).toBe('APPROVED');
    expect(variationClientApproval(vo({ status: 'REJECTED' }))).toBe('REJECTED');
    expect(variationClientApproval(vo({ status: 'WITHDRAWN' }))).toBe('WITHDRAWN');
  });
});

describe('summariseVariations', () => {
  it('counts pending as the two in-flight states only', () => {
    const totals = summariseVariations([
      vo({ id: 'a', status: 'DRAFT' }),
      vo({ id: 'b', status: 'PENDING_INTERNAL' }),
      vo({ id: 'c', status: 'INTERNAL_APPROVED' }),
      vo({ id: 'd', status: 'REJECTED' }),
      vo({ id: 'e', status: 'WITHDRAWN' }),
    ]);
    expect(totals.pendingCount).toBe(2);
    expect(totals.approvedCount).toBe(0);
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

  it('adds at-risk exposure only where an authorisation exists', () => {
    const totals = summariseVariations([
      vo({ id: 'a', atRiskAuthorisationCount: 1, atRiskExposure: '20000.00' }),
      vo({ id: 'b', atRiskAuthorisationCount: 2, atRiskExposure: '5000.00' }),
      vo({ id: 'c', atRiskAuthorisationCount: 0, atRiskExposure: '0.00' }),
    ]);
    expect(totals.atRiskCount).toBe(2);
    expect(totals.atRiskExposure).toBe('25000.00');
  });

  /** A withheld figure contributes nothing rather than being read as a zero it did not assert. */
  it('tolerates withheld amounts without financial visibility', () => {
    const totals = summariseVariations([
      vo({ id: 'a', atRiskAuthorisationCount: 1, atRiskExposure: null }),
    ]);
    expect(totals.atRiskCount).toBe(1);
    expect(totals.atRiskExposure).toBe('0.00');
  });
});
