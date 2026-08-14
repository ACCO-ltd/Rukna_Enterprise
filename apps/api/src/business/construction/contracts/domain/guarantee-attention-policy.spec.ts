import {
  deriveGuaranteeAttention,
  GUARANTEE_EXPIRING_SOON_DAYS,
} from './guarantee-attention-policy.js';

const NOW = new Date('2026-08-14T10:00:00.000Z');

function daysFromNow(days: number): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

describe('deriveGuaranteeAttention (A7 — backend-derived, backend clock)', () => {
  it('returns NONE for a guarantee expiring well beyond the window', () => {
    expect(deriveGuaranteeAttention(daysFromNow(90), 'ACTIVE', NOW)).toBe('NONE');
  });

  it('returns EXPIRING_SOON at the window boundary', () => {
    expect(deriveGuaranteeAttention(daysFromNow(GUARANTEE_EXPIRING_SOON_DAYS), 'ACTIVE', NOW)).toBe(
      'EXPIRING_SOON',
    );
    expect(deriveGuaranteeAttention(daysFromNow(1), 'ACTIVE', NOW)).toBe('EXPIRING_SOON');
  });

  it('treats a guarantee expiring today as EXPIRING_SOON, not yet expired', () => {
    expect(deriveGuaranteeAttention(daysFromNow(0), 'ACTIVE', NOW)).toBe('EXPIRING_SOON');
  });

  it('returns EXPIRED once the expiry date has passed', () => {
    expect(deriveGuaranteeAttention(daysFromNow(-1), 'ACTIVE', NOW)).toBe('EXPIRED');
  });

  it('does not raise attention for settled (non-ACTIVE) guarantees', () => {
    expect(deriveGuaranteeAttention(daysFromNow(-100), 'DISCHARGED', NOW)).toBe('NONE');
    expect(deriveGuaranteeAttention(daysFromNow(5), 'CALLED', NOW)).toBe('NONE');
  });

  it('maps a stored EXPIRED status straight to EXPIRED attention', () => {
    expect(deriveGuaranteeAttention(daysFromNow(90), 'EXPIRED', NOW)).toBe('EXPIRED');
  });

  it('honours a custom window', () => {
    expect(deriveGuaranteeAttention(daysFromNow(45), 'ACTIVE', NOW, 60)).toBe('EXPIRING_SOON');
    expect(deriveGuaranteeAttention(daysFromNow(45), 'ACTIVE', NOW, 30)).toBe('NONE');
  });
});
