import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { listJournalEntries } from '@/features/accounting/api/accounting-api';

import { JournalBook, bookRange } from './journal-book';

/** GL-J — the day book: every posted entry in a period, whatever posted it. */
vi.mock('@/features/accounting/api/accounting-api', () => ({ listJournalEntries: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const entry = (over: Record<string, unknown>) => ({
  id: 'j1', journalNumber: 'JE-000010', accountingDate: '2026-10-06', description: 'Customer receipt RCP-000001', currencyCode: 'USD',
  sourceDocumentType: 'PAYMENT_RECEIPT', sourceDocumentId: 'r1', entryPurpose: 'NORMAL', reversalOfJournalEntryId: null, totalAmount: '12500.00',
  ...over,
});

beforeEach(() => {
  vi.mocked(listJournalEntries).mockResolvedValue([
    entry({}),
    entry({ id: 'j2', journalNumber: 'JE-000011', description: 'Supplier payment PMT-000001', sourceDocumentType: 'SUPPLIER_PAYMENT', sourceDocumentId: 'p1', totalAmount: '640.00' }),
    entry({ id: 'j3', journalNumber: 'JE-000012', description: 'Reversal of JE-000011', sourceDocumentType: 'MANUAL_JOURNAL', sourceDocumentId: 'reversal-j2', reversalOfJournalEntryId: 'j2', totalAmount: '640.00' }),
  ] as never);
});

describe('bookRange', () => {
  it('counts each period back from today', () => {
    expect(bookRange('month', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(bookRange('lastMonth', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(bookRange('lastMonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(bookRange('year', '2026-10-31')).toEqual({ from: '2026-01-01', to: '2026-10-31' });
  });
});

describe('JournalBook (GL-J)', () => {
  it('lists every source, each opening its journal and its document, with the total', async () => {
    renderWithProviders(<JournalBook />);
    const table = await screen.findByRole('table', { name: 'All entries' });
    expect(within(table).getByRole('link', { name: 'JE-000010' })).toHaveAttribute('href', '/finance/accounting/journals/j1');
    expect(within(table).getByRole('link', { name: 'Receipt' })).toHaveAttribute('href', '/receipts/r1');
    expect(within(table).getByRole('link', { name: 'Supplier payment' })).toHaveAttribute('href', '/finance/accounting/payments/p1');
    expect(within(table).getByText('· Reversal')).toBeInTheDocument();
    expect(within(table).getByText('3 entries')).toBeInTheDocument();
    expect(within(table).getByText('$13,780.00')).toBeInTheDocument();
  });

  it('narrows to one source and asks for a new period', async () => {
    const user = userEvent.setup();
    renderWithProviders(<JournalBook />);
    await screen.findByRole('table', { name: 'All entries' });
    await user.selectOptions(screen.getByLabelText('Source'), 'SUPPLIER_PAYMENT');
    expect(screen.getByText('1 entry')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'This year' }));
    expect(vi.mocked(listJournalEntries)).toHaveBeenLastCalledWith(expect.stringMatching(/-01-01$/), expect.any(String));
  });
});
