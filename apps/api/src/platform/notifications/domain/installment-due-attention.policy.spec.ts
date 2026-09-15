import {
  INSTALLMENT_DUE_SOON_DAYS,
  deriveInstallmentDueAttention,
  utcCalendarDaysUntil,
} from './installment-due-attention.policy.js';

/** A fixed "now" mid-day UTC, to prove the arithmetic is on calendar days not wall-clock ms. */
const NOW = new Date('2026-09-15T13:45:00.000Z');

/** Build a `@db.Date`-style midnight-UTC date `days` calendar days from NOW's date. */
function dueDateDaysFromNow(days: number): Date {
  const base = Date.UTC(2026, 8, 15); // 2026-09-15
  return new Date(base + days * 86_400_000);
}

describe('deriveInstallmentDueAttention', () => {
  it('exports the 7-day reminder window', () => {
    expect(INSTALLMENT_DUE_SOON_DAYS).toBe(7);
  });

  it('day -1 (yesterday) is OVERDUE', () => {
    expect(deriveInstallmentDueAttention(dueDateDaysFromNow(-1), NOW)).toBe('OVERDUE');
  });

  it('day 0 (due today) is DUE_SOON', () => {
    expect(deriveInstallmentDueAttention(dueDateDaysFromNow(0), NOW)).toBe('DUE_SOON');
  });

  it('day 7 (window edge, inclusive) is DUE_SOON', () => {
    expect(deriveInstallmentDueAttention(dueDateDaysFromNow(7), NOW)).toBe('DUE_SOON');
  });

  it('day 8 (just past the window) is NONE', () => {
    expect(deriveInstallmentDueAttention(dueDateDaysFromNow(8), NOW)).toBe('NONE');
  });

  it('counts on UTC calendar days regardless of the time-of-day component of now', () => {
    // Due at 00:00 UTC tomorrow; now is 13:45 today. Wall-clock ms is < 1 day, but the calendar-day
    // count is exactly 1 → DUE_SOON, and never rounds to 0/OVERDUE.
    const due = new Date('2026-09-16T00:00:00.000Z');
    expect(utcCalendarDaysUntil(due, NOW)).toBe(1);
    expect(deriveInstallmentDueAttention(due, NOW)).toBe('DUE_SOON');
  });

  it('respects a custom window', () => {
    expect(deriveInstallmentDueAttention(dueDateDaysFromNow(10), NOW, 14)).toBe('DUE_SOON');
    expect(deriveInstallmentDueAttention(dueDateDaysFromNow(15), NOW, 14)).toBe('NONE');
  });
});
