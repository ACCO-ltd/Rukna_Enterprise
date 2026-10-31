import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplierStatement as SupplierStatementData } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * AP-3 / SS — the supplier statement: the bills still owed with what settled each, every movement
 * in statement order (billed, paid, owed), and the PDF to download or send to the supplier.
 */
const search = vi.hoisted(() => ({ params: new URLSearchParams('supplierId=s1&from=2026-01-01&to=2026-10-30') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => search.params }));
vi.mock('@/features/procurement/hooks/use-procurement', () => ({
  useSuppliers: () => ({ isPending: false, data: [{ id: 's1', name: 'Berbera Cement Supplies', code: 'SUP-BCS' }] }),
}));
const api = vi.hoisted(() => ({ apiClient: vi.fn() }));
vi.mock('@/lib/api-client', async (original) => ({ ...(await original<object>()), apiClient: api.apiClient }));

import { SupplierStatement } from './supplier-statement';

const STATEMENT: SupplierStatementData = {
  supplier: { id: 's1', name: 'Berbera Cement Supplies', code: 'SUP-BCS', address: null },
  organization: { name: 'ACCO Ltd' },
  from: '2026-01-01',
  to: '2026-10-30',
  openBills: [
    { billId: 'b1', number: 'BILL-000001', supplierInvoiceNumber: 'BCS-INV-77', billDate: '2026-10-01', dueDate: '2026-10-29', total: '1000.00', settled: '120.00', balance: '880.00', daysOverdue: 1, opening: false },
  ],
  openingBalance: '0.00',
  lines: [
    { date: '2026-10-01', kind: 'BILL', documentId: 'b1', reference: 'BILL-000001', description: 'BCS-INV-77', debit: null, credit: '1000.00', balance: '1000.00' },
    { date: '2026-10-28', kind: 'PAYMENT', documentId: 'p1', reference: 'PMT-000001', description: 'TT-2210', debit: '750.00', credit: null, balance: '250.00' },
  ],
  totals: { debits: '750.00', credits: '1000.00' },
  closingBalance: '250.00',
  aging: { current: '0.00', d1_30: '880.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00' },
  unapplied: '630.00',
  pendingPayments: '0.00',
};

beforeEach(() => {
  api.apiClient.mockReset();
  api.apiClient.mockImplementation((url: string) => {
    if (url.includes('/statement/document')) return Promise.resolve(new Blob(['%PDF']));
    if (url.startsWith('/communications')) return Promise.resolve([]);
    if (url.includes('/statement/whatsapp/preview'))
      return Promise.resolve({ templateConfigured: false, whatsappConfigured: false, recipients: [], defaultRecipient: null, message: 'Hello', filename: 'x.pdf', sendable: false, blockedReason: 'TEMPLATE_NOT_CONFIGURED' });
    return Promise.resolve(STATEMENT);
  });
});

describe('SupplierStatement (SS)', () => {
  it('lists the bills still owed, with what settled each and the days late', async () => {
    renderWithProviders(<SupplierStatement />, { permissions: ['manage:payable'] });
    const [open] = await screen.findAllByRole('region', { name: 'Bills still owed' });
    expect(within(open).getByRole('link', { name: 'BILL-000001' })).toHaveAttribute('href', '/finance/accounting/bills/b1');
    expect(within(open).getByText('BCS-INV-77')).toBeInTheDocument();
    expect(within(open).getByText('$880.00')).toBeInTheDocument();
    expect(within(open).getByText('1 day late')).toBeInTheDocument();
  });

  it('puts billed before paid in the activity, as a statement reads', async () => {
    renderWithProviders(<SupplierStatement />, { permissions: ['manage:payable'] });
    await screen.findAllByRole('region', { name: 'Bills still owed' });
    const activity = screen.getAllByRole('region', { name: 'Supplier statement' }).at(-1)!;
    const headers = within(activity).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.indexOf('Billed')).toBeLessThan(headers.indexOf('Paid'));
  });

  it('downloads the branded PDF and opens the WhatsApp send for the supplier', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    renderWithProviders(<SupplierStatement />, { permissions: ['manage:payable'], withToast: true });
    await user.click(await screen.findByRole('button', { name: 'PDF' }));
    expect(api.apiClient).toHaveBeenCalledWith('/finance/suppliers/s1/statement/document?from=2026-01-01&to=2026-10-30', { responseType: 'blob' });
    await user.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));
    expect(await screen.findByText('Send statement to the supplier')).toBeInTheDocument();
    expect(api.apiClient).toHaveBeenCalledWith('/finance/suppliers/s1/statement/whatsapp/preview?from=2026-01-01&to=2026-10-30');
  });
});
