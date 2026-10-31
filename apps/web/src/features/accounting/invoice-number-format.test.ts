import { describe, expect, it } from 'vitest';

import { previewInvoiceNumber } from './invoice-number-format';

describe('previewInvoiceNumber (CI-8)', () => {
  it('matches the server for each format', () => {
    const f = (resetPolicy: 'NEVER' | 'YEARLY' | 'MONTHLY' | 'DAILY', paddingLength: number) => ({ prefix: 'INV-', resetPolicy, paddingLength });
    expect(previewInvoiceNumber(f('NEVER', 6), '2026-10-30', 3151)).toBe('INV-003151');
    expect(previewInvoiceNumber(f('YEARLY', 4), '2026-10-30', 1)).toBe('INV-2026-0001');
    expect(previewInvoiceNumber(f('MONTHLY', 4), '2026-10-30', 12)).toBe('INV-2026-10-0012');
    expect(previewInvoiceNumber(f('DAILY', 3), '2026-10-30', 7)).toBe('INV-2026-10-30-007');
  });
});
