import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CloseChecklist as Data } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { CloseChecklist } from './close-checklist';

const data: Data = {
  period: { id: 'p1', name: 'Oct 2026', startDate: '2026-10-01', endDate: '2026-10-31', status: 'OPEN' },
  periods: [{ id: 'p1', name: 'Oct 2026', status: 'OPEN' }],
  requireBankReconciliation: true,
  readyToClose: false,
  checks: [
    { key: 'documents', status: 'TODO', detail: '1 document(s) dated in Oct 2026 are not posted.', href: null,
      items: [{ key: 'invoices', label: 'Client invoices', status: 'TODO', detail: '1 not posted', href: '/finance/accounting/invoices', count: 1 }] },
    { key: 'banks', status: 'BLOCKED', detail: 'Reconcile each bank account — required before closing.', href: '/finance/accounting/bank-reconciliation',
      items: [{ key: 'b1', label: 'Premier Bank · Operating', status: 'TODO', detail: 'Never reconciled', href: '/finance/accounting/bank-reconciliation' }] },
    { key: 'tie-out', status: 'DONE', detail: 'The AR and AP control accounts agree with their subledgers.', href: '/finance/accounting/reconciliation', items: [] },
    { key: 'vat', status: 'INFO', detail: 'Output VAT for Oct 2026: 50.00', href: '/finance/accounting/vat-report', items: [] },
    { key: 'lock', status: 'BLOCKED', detail: 'Locking stops ordinary postings.', href: '/finance/accounting/periods', items: [] },
    { key: 'close', status: 'BLOCKED', detail: 'Finish the checks above first.', href: '/finance/accounting/periods', items: [] },
  ],
};

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: vi.fn(async () => data),
}));
vi.mock('@/features/auth/permissions/can', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/permissions/can')>()),
  usePermissions: () => ({ can: () => true }),
}));

describe('CloseChecklist (Step 6)', () => {
  it('lists each check with its state and the screen that fixes it', async () => {
    renderWithProviders(<CloseChecklist />);
    const checks = await screen.findByRole('list', { name: 'Close checks' });
    expect(screen.getByText('1 of 6 checks done')).toBeInTheDocument();
    const banks = within(checks).getByRole('heading', { name: 'Reconcile the bank accounts' }).closest('li')!;
    expect(within(banks).getByLabelText('Blocking the close')).toBeInTheDocument();
    expect(within(banks).getByRole('link', { name: 'Bank reconciliation' })).toHaveAttribute('href', '/finance/accounting/bank-reconciliation');
    expect(within(checks).getByRole('link', { name: 'Client invoices' })).toHaveAttribute('href', '/finance/accounting/invoices');
    expect(screen.getByRole('switch', { name: /Require bank reconciliation/ })).toBeChecked();
  });
});
