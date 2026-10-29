import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientStatement as ClientStatementData } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * AR-3 — the client statement: opening balance, every movement with a running balance, the
 * closing balance, and links to the documents.
 */
const search = vi.hoisted(() => ({ params: new URLSearchParams('clientId=c1&from=2026-01-01&to=2026-10-31') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => search.params }));
vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({ isPending: false, data: [{ id: 'c1', name: 'Hargeisa Water Agency', code: 'HWA' }] }),
}));
const api = vi.hoisted(() => ({ apiClient: vi.fn() }));
vi.mock('@/lib/api-client', async (original) => ({ ...(await original<object>()), apiClient: api.apiClient }));

import { ClientStatement } from './client-statement';

const STATEMENT: ClientStatementData = {
  client: { id: 'c1', name: 'Hargeisa Water Agency', code: 'HWA' },
  from: '2026-01-01',
  to: '2026-10-31',
  openingBalance: '0.00',
  lines: [
    { date: '2026-10-29', kind: 'INVOICE', documentId: 'inv-1', reference: 'INV-000005', description: null, debit: '1400.00', credit: null, balance: '1400.00' },
    { date: '2026-10-29', kind: 'RECEIPT', documentId: 'rcp-1', reference: 'RCP-000012', description: 'E2E-AR', debit: null, credit: '1000.00', balance: '400.00' },
  ],
  totals: { debits: '1400.00', credits: '1000.00' },
  closingBalance: '400.00',
  aging: { current: '400.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00' },
  onAccount: '0.00',
};

beforeEach(() => {
  api.apiClient.mockReset().mockResolvedValue(STATEMENT);
});

describe('ClientStatement', () => {
  it('reads the client and period from the link, and shows the running balance to the closing balance', async () => {
    renderWithProviders(<ClientStatement />);
    const table = within(await screen.findByRole('table'));
    expect(api.apiClient).toHaveBeenCalledWith('/finance/clients/c1/statement?from=2026-01-01&to=2026-10-31');
    expect(table.getByRole('link', { name: 'INV-000005' })).toHaveAttribute('href', '/finance/accounting/invoices/inv-1');
    expect(table.getByRole('link', { name: 'RCP-000012' })).toHaveAttribute('href', '/receipts/rcp-1');
    expect(table.getAllByText('$400.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Hargeisa Water Agency · Jan 1, 2026 to Oct 31, 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
  });

  it('asks for a client before loading anything', () => {
    search.params = new URLSearchParams();
    renderWithProviders(<ClientStatement />);
    expect(screen.getByText('The statement lists every invoice, credit note and payment for the client across all projects, with a running balance.')).toBeInTheDocument();
    expect(api.apiClient).not.toHaveBeenCalled();
  });
});
