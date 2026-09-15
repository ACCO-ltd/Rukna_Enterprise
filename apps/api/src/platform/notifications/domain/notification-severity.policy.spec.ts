import { deriveNotificationSeverity } from './notification-severity.policy.js';

describe('deriveNotificationSeverity', () => {
  it('a due stage is a WARNING', () => {
    expect(deriveNotificationSeverity('STAGE_PAYMENT_DUE')).toBe('WARNING');
  });

  it('an overdue stage is URGENT', () => {
    expect(deriveNotificationSeverity('STAGE_PAYMENT_OVERDUE')).toBe('URGENT');
  });

  it('an overdue invoice is a WARNING at buckets 1 and 30', () => {
    expect(deriveNotificationSeverity('CLIENT_INVOICE_OVERDUE', 1)).toBe('WARNING');
    expect(deriveNotificationSeverity('CLIENT_INVOICE_OVERDUE', 30)).toBe('WARNING');
  });

  it('an overdue invoice escalates to URGENT at buckets 60 and 90', () => {
    expect(deriveNotificationSeverity('CLIENT_INVOICE_OVERDUE', 60)).toBe('URGENT');
    expect(deriveNotificationSeverity('CLIENT_INVOICE_OVERDUE', 90)).toBe('URGENT');
  });

  it('an overdue invoice with no bucket falls back to WARNING (not URGENT)', () => {
    expect(deriveNotificationSeverity('CLIENT_INVOICE_OVERDUE')).toBe('WARNING');
  });
});
