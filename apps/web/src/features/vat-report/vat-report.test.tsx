import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VatReport as VatReportData } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { VatReport } from './vat-report';

const data: VatReportData = {
  from: '2026-10-01',
  to: '2026-10-31',
  output: {
    byRate: [{ rate: '5.0000', taxable: '1000.00', vat: '50.00' }],
    invoices: { count: 3, taxable: '1000.00', vat: '50.00' },
    creditNotes: { count: 0, taxable: '0.00', vat: '0.00' },
    adjustments: { count: 1, vat: '10.00' },
    total: '60.00',
    lines: [
      { journalEntryId: 'j1', journalNumber: 'JE-1', accountingDate: '2026-10-02', kind: 'INVOICE', documentId: 'i1', documentNumber: 'INV-000001', partyName: 'Water Agency', taxableAmount: '1000.00', rate: '5.0000', vat: '50.00', reversal: false },
      { journalEntryId: 'j3', journalNumber: 'JE-3', accountingDate: '2026-10-03', kind: 'INVOICE', documentId: 'i2', documentNumber: 'INV-000002', partyName: 'Water Agency', taxableAmount: '-400.00', rate: '5.0000', vat: '-20.00', reversal: true },
      { journalEntryId: 'j4', journalNumber: 'JE-4', accountingDate: '2026-10-04', kind: 'ADJUSTMENT', documentId: null, documentNumber: null, partyName: null, taxableAmount: null, rate: null, vat: '10.00', reversal: false },
    ],
  },
  input: { count: 2, taxable: '800.00', vat: '40.00' },
  closingBalance: '60.00',
};

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: vi.fn(async () => data),
}));

describe('VatReport (Step 6)', () => {
  it('shows output VAT by rate and by posting, with input VAT for information', async () => {
    renderWithProviders(<VatReport />);
    const summary = await screen.findByRole('table', { name: 'Output VAT by rate' });
    expect(within(summary).getByRole('row', { name: /Sales at 5% \$1,000\.00 \$50\.00/ })).toBeInTheDocument();
    expect(within(summary).getByRole('row', { name: /1 journal adjustment/ })).toHaveTextContent('$10.00');
    expect(within(summary).getAllByRole('row').at(-1)).toHaveTextContent('$60.00');

    const lines = screen.getByRole('table', { name: 'Every VAT posting in the period' });
    expect(within(lines).getByRole('link', { name: 'INV-000001' })).toHaveAttribute('href', '/finance/accounting/invoices/i1');
    expect(within(lines).getByText(/Invoice · reversal/)).toBeInTheDocument();
    expect(within(lines).getByText('JE-4')).toBeInTheDocument();
    expect(screen.getByText(/2 bills posted in this period carried \$40\.00 of VAT/)).toBeInTheDocument();
  });
});
