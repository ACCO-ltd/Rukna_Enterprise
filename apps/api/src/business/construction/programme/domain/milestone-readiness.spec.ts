import { Decimal } from '@prisma/client/runtime/library';

import { leafPercentComplete } from '../../progress/domain/progress-rollup.js';
import {
  isMilestoneReadyToVerify,
  isPackageFullyVerified,
  type ReadinessLeaf,
} from './milestone-readiness.js';

const leaf = (quantity: string | null, verified: string, nodeRole = 'WORK'): ReadinessLeaf => ({
  quantity: quantity === null ? null : new Decimal(quantity),
  nodeRole,
  verified: new Decimal(verified),
});

describe('isMilestoneReadyToVerify (ADR-021 amendment 2026-09-28)', () => {
  it('is ready when PLANNED and every linked package is fully verified', () => {
    expect(
      isMilestoneReadyToVerify('PLANNED', [{ fullyVerified: true }, { fullyVerified: true }]),
    ).toBe(true);
  });

  it('is not ready while any linked package is short', () => {
    expect(
      isMilestoneReadyToVerify('PLANNED', [{ fullyVerified: true }, { fullyVerified: false }]),
    ).toBe(false);
  });

  it('is never ready with no packages linked — no evidence either way', () => {
    expect(isMilestoneReadyToVerify('PLANNED', [])).toBe(false);
  });

  it('is not ready once VERIFIED — there is nothing left to verify', () => {
    expect(isMilestoneReadyToVerify('VERIFIED', [{ fullyVerified: true }])).toBe(false);
  });
});

describe('isPackageFullyVerified — exact quantities, not the rounded display %', () => {
  it('199.1 of 200 displays as 100% but is NOT fully verified', () => {
    // The display figure rounds up…
    expect(leafPercentComplete(new Decimal('199.1'), new Decimal('200'))).toBe(100);
    // …but readiness reads the exact quantities.
    expect(isPackageFullyVerified([leaf('200', '199.1')])).toBe(false);
    expect(isMilestoneReadyToVerify('PLANNED', [{ fullyVerified: false }])).toBe(false);
  });

  it('is fully verified when every work leaf has verified >= its quantity', () => {
    expect(isPackageFullyVerified([leaf('200', '200'), leaf('0.5', '0.5')])).toBe(true);
  });

  it('ignores a CONTINGENCY leaf (a reserve, not work)', () => {
    expect(isPackageFullyVerified([leaf('10', '10'), leaf('1', '0', 'CONTINGENCY')])).toBe(true);
  });

  it('a leaf with no measurable quantity (or missing from the BOQ) holds the package open', () => {
    expect(isPackageFullyVerified([leaf('10', '10'), leaf(null, '0')])).toBe(false);
    expect(isPackageFullyVerified([leaf('10', '10'), leaf('0', '0')])).toBe(false);
  });

  it('a package with no work leaves is not fully verified', () => {
    expect(isPackageFullyVerified([])).toBe(false);
    expect(isPackageFullyVerified([leaf('1', '1', 'CONTINGENCY')])).toBe(false);
  });
});
