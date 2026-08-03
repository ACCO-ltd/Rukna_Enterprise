import { describe, expect, it } from 'vitest';

import { formatDate, formatMoney, formatNumber } from './format';

describe('formatMoney', () => {
  it('formats the decimal STRING the API sends, without losing precision', () => {
    expect(formatMoney('4500000.00', 'USD', 'en')).toBe('$4,500,000.00');
  });

  it('always shows two fraction digits', () => {
    expect(formatMoney('1200', 'USD', 'en')).toBe('$1,200.00');
    expect(formatMoney('1200.5', 'USD', 'en')).toBe('$1,200.50');
  });

  // Currency is nullable on both projects and BOQ nodes. Labelling an amount with a
  // guessed currency is worse than labelling it with none.
  it('omits the symbol when currency is null rather than inventing one', () => {
    expect(formatMoney('4500000.00', null, 'en')).toBe('4,500,000.00');
  });

  it('returns null for absent values so callers can render "not set"', () => {
    expect(formatMoney(null, 'USD')).toBeNull();
    expect(formatMoney(undefined, 'USD')).toBeNull();
    expect(formatMoney('', 'USD')).toBeNull();
  });

  it('returns null for values that are not numeric', () => {
    expect(formatMoney('not-a-number', 'USD')).toBeNull();
  });

  // Deliberate product decision: Gulf construction contracts use Western numerals, so
  // financial figures match the paperwork they are reconciled against.
  it('uses Western digits in Arabic', () => {
    const formatted = formatMoney('4500000.00', 'USD', 'ar');

    expect(formatted).toContain('4');
    expect(formatted).not.toMatch(/[٠-٩]/);
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1200, 'en')).toBe('1,200');
  });

  it('uses Western digits in Arabic', () => {
    expect(formatNumber(1200, 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('returns null when there is no value', () => {
    expect(formatNumber(null)).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats an ISO timestamp as a short calendar date', () => {
    expect(formatDate('2026-08-02T14:00:00.000Z', 'en')).toBe('Aug 2, 2026');
  });

  /**
   * Dates are stored as UTC calendar dates. Formatting in local time shifts them a day
   * backwards for anyone west of UTC, which would misreport a contract start date.
   */
  it('does not shift the calendar day across time zones', () => {
    expect(formatDate('2026-09-01T00:00:00.000Z', 'en')).toBe('Sep 1, 2026');
  });

  it('returns null for absent or unparseable values', () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate('')).toBeNull();
    expect(formatDate('nonsense')).toBeNull();
  });
});
