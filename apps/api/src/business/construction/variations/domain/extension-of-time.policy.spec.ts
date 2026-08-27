import {
  ExtensionOfTimePolicy,
  deriveGrantedDays,
  type ContractStatusValue,
} from './extension-of-time.policy.js';

describe('ExtensionOfTimePolicy — contract state guard (CONST-VAR-009)', () => {
  it('allows an extension on a live contract (ACTIVE / FINAL_ACCOUNT_PENDING)', () => {
    expect(ExtensionOfTimePolicy.contractStateAllowsExtension('ACTIVE')).toBe(true);
    expect(ExtensionOfTimePolicy.contractStateAllowsExtension('FINAL_ACCOUNT_PENDING')).toBe(true);
  });

  it('rejects a terminal contract (CLOSED / CANCELLED / TERMINATED)', () => {
    for (const s of ['CLOSED', 'CANCELLED', 'TERMINATED'] as ContractStatusValue[]) {
      expect(ExtensionOfTimePolicy.contractStateAllowsExtension(s)).toBe(false);
      expect(ExtensionOfTimePolicy.isTerminal(s)).toBe(true);
    }
  });

  it('rejects a not-yet-executed contract (DRAFT / UNDER_REVIEW / PENDING_SIGNATURE) but not as terminal', () => {
    for (const s of ['DRAFT', 'UNDER_REVIEW', 'PENDING_SIGNATURE'] as ContractStatusValue[]) {
      expect(ExtensionOfTimePolicy.contractStateAllowsExtension(s)).toBe(false);
      expect(ExtensionOfTimePolicy.isTerminal(s)).toBe(false);
    }
  });
});

describe('deriveGrantedDays — CONST-VAR-009 derivation', () => {
  it('is the whole-day difference previous→new for a normal forward extension', () => {
    // 2027-01-01 → 2027-01-31 is 30 days.
    expect(
      deriveGrantedDays(new Date('2027-01-01T00:00:00.000Z'), new Date('2027-01-31T00:00:00.000Z')),
    ).toBe(30);
  });

  it('is null when the contract had no previous end date (nothing to diff against)', () => {
    expect(deriveGrantedDays(null, new Date('2027-01-31T00:00:00.000Z'))).toBeNull();
    expect(deriveGrantedDays(undefined, new Date('2027-01-31T00:00:00.000Z'))).toBeNull();
  });

  it('preserves a negative result when the date is brought forward (not clamped)', () => {
    expect(
      deriveGrantedDays(new Date('2027-02-10T00:00:00.000Z'), new Date('2027-02-01T00:00:00.000Z')),
    ).toBe(-9);
  });

  it('is 0 when the new date equals the previous date', () => {
    expect(
      deriveGrantedDays(new Date('2027-03-15T00:00:00.000Z'), new Date('2027-03-15T00:00:00.000Z')),
    ).toBe(0);
  });

  it('counts whole UTC days across a month/year boundary', () => {
    // 2026-12-31 → 2027-01-01 is 1 day.
    expect(
      deriveGrantedDays(new Date('2026-12-31T00:00:00.000Z'), new Date('2027-01-01T00:00:00.000Z')),
    ).toBe(1);
  });
});
