import { describe, expect, it } from 'vitest';

import { formatDate, formatMoney, formatNumber, formatStatus, relativeTime } from './format';

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
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1200, 'en')).toBe('1,200');
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

describe('relativeTime', () => {
  const NOW = new Date('2026-08-04T12:00:00.000Z');

  it('returns "just now" for a timestamp within 60 seconds', () => {
    const recent = new Date(NOW.getTime() - 30_000).toISOString();
    expect(relativeTime(recent, 'en', NOW)).toBe('now');
  });

  it('returns "X minutes ago" for a past timestamp within the hour', () => {
    const past = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    expect(relativeTime(past, 'en', NOW)).toBe('10 minutes ago');
  });

  it('returns "in X minutes" for a future timestamp within the hour', () => {
    const future = new Date(NOW.getTime() + 10 * 60_000).toISOString();
    expect(relativeTime(future, 'en', NOW)).toBe('in 10 minutes');
  });

  it('returns "X hours ago" for a past timestamp within 24 hours', () => {
    const past = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
    expect(relativeTime(past, 'en', NOW)).toBe('3 hours ago');
  });

  it('returns "X days ago" for a past timestamp within 30 days', () => {
    const past = new Date(NOW.getTime() - 5 * 86_400_000).toISOString();
    expect(relativeTime(past, 'en', NOW)).toBe('5 days ago');
  });

  it('returns null for absent or unparseable values', () => {
    expect(relativeTime(null)).toBeNull();
    expect(relativeTime('')).toBeNull();
    expect(relativeTime('nonsense')).toBeNull();
  });
});

describe('formatStatus', () => {
  it('maps DRAFT to NEUTRAL (not muted)', () => {
    expect(formatStatus('DRAFT')).toEqual({ token: 'NEUTRAL', muted: false });
  });

  it('maps ACTIVE to SUCCESS (not muted)', () => {
    expect(formatStatus('ACTIVE')).toEqual({ token: 'SUCCESS', muted: false });
  });

  it('maps CANCELLED to DANGER (muted — terminal but not urgent)', () => {
    expect(formatStatus('CANCELLED')).toEqual({ token: 'DANGER', muted: true });
  });

  it('maps CLOSED to SUCCESS (muted — resolved but not urgent)', () => {
    expect(formatStatus('CLOSED')).toEqual({ token: 'SUCCESS', muted: true });
  });

  it('maps SUPERSEDED to HISTORICAL (muted)', () => {
    expect(formatStatus('SUPERSEDED')).toEqual({ token: 'HISTORICAL', muted: true });
  });

  it('maps PENDING_INTERNAL_APPROVAL to IN_PROGRESS', () => {
    expect(formatStatus('PENDING_INTERNAL_APPROVAL')).toEqual({ token: 'IN_PROGRESS', muted: false });
  });

  it('maps RETURNED_FOR_REVISION to WARNING', () => {
    expect(formatStatus('RETURNED_FOR_REVISION')).toEqual({ token: 'WARNING', muted: false });
  });

  it('maps PARTIALLY_PAID to WARNING', () => {
    expect(formatStatus('PARTIALLY_PAID')).toEqual({ token: 'WARNING', muted: false });
  });

  it('maps PAID to SUCCESS', () => {
    expect(formatStatus('PAID')).toEqual({ token: 'SUCCESS', muted: false });
  });

  it('falls back to NEUTRAL for unknown statuses rather than throwing', () => {
    expect(formatStatus('SOME_FUTURE_STATUS')).toEqual({ token: 'NEUTRAL', muted: false });
  });

  it('falls back to NEUTRAL for null or undefined', () => {
    expect(formatStatus(null)).toEqual({ token: 'NEUTRAL', muted: false });
    expect(formatStatus(undefined)).toEqual({ token: 'NEUTRAL', muted: false });
  });
});
