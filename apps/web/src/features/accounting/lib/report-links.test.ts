import { describe, expect, it } from 'vitest';

describe('profitLossHref / rangeFromParams (Step 4 drill-down)', () => {
  it('round-trips a month through the URL', async () => {
    const { profitLossHref, rangeFromParams } = await import('./report-links');
    const href = profitLossHref({ from: '2026-10-01', to: '2026-10-31' });
    expect(href).toBe('/finance/accounting/profit-loss?from=2026-10-01&to=2026-10-31');
    expect(rangeFromParams(new URL(href, 'http://x').searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('ignores a missing, malformed or reversed range', async () => {
    const { rangeFromParams } = await import('./report-links');
    expect(rangeFromParams(new URLSearchParams('from=2026-10-01'))).toBeNull();
    expect(rangeFromParams(new URLSearchParams('from=oct&to=nov'))).toBeNull();
    expect(rangeFromParams(new URLSearchParams('from=2026-10-31&to=2026-10-01'))).toBeNull();
    expect(rangeFromParams(null)).toBeNull();
  });
});
