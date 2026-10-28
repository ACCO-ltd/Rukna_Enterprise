import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankStatementWorkspace } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { bankStatementsApi } from './api';
import { StatementWorkspace } from './statement-workspace';

vi.mock('./api', () => ({
  bankStatementsApi: { workspace: vi.fn(), acceptSuggestions: vi.fn(), reconcile: vi.fn(), match: vi.fn(), unmatch: vi.fn(), post: vi.fn(), remove: vi.fn(), list: vi.fn() },
}));
vi.mock('@/features/auth/permissions/can', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/permissions/can')>()),
  usePermissions: () => ({ can: () => true }),
}));
vi.mock('@/features/accounting/hooks/use-accounting', () => ({ useAccounts: () => ({ data: [] }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const ledger = (id: string, amount: string, day: string) => ({
  journalLineId: id, journalEntryId: `je-${id}`, journalNumber: `JE-${id}`, accountingDate: day, description: null, amount, broughtForward: false,
});
const base: BankStatementWorkspace = {
  statement: {
    id: 'st1', bankAccountId: 'b1', bankName: 'Premier Bank', accountName: 'Operating', periodStart: '2026-10-01', statementDate: '2026-10-31',
    openingBalance: '0.00', closingBalance: '685.00', status: 'OPEN', lineCount: 3, unmatchedCount: 3, reconciledAt: null,
  },
  lines: [
    { id: 'l1', lineNumber: 1, transactionDate: '2026-10-02', description: 'Transfer in', reference: null, amount: '1000.00', matchStatus: 'UNMATCHED', matched: null, suggestion: ledger('1', '1000.00', '2026-10-01') },
    { id: 'l2', lineNumber: 2, transactionDate: '2026-10-04', description: 'Payment out', reference: 'TRF-77', amount: '-300.00', matchStatus: 'UNMATCHED', matched: null, suggestion: ledger('2', '-300.00', '2026-10-03') },
    { id: 'l3', lineNumber: 3, transactionDate: '2026-10-15', description: 'Monthly charge', reference: null, amount: '-15.00', matchStatus: 'UNMATCHED', matched: null, suggestion: null },
  ],
  uncleared: [ledger('1', '1000.00', '2026-10-01'), ledger('2', '-300.00', '2026-10-03'), ledger('3', '-200.00', '2026-10-10')],
  reconciliation: { ledgerBalance: '500.00', outstanding: '500.00', adjustedLedger: '0.00', statementClosing: '685.00', difference: '685.00', balanced: false },
  previousClosing: null,
  canReconcile: false,
};

beforeEach(() => {
  vi.mocked(bankStatementsApi.workspace).mockResolvedValue(base);
  vi.mocked(bankStatementsApi.acceptSuggestions).mockResolvedValue({
    ...base,
    statement: { ...base.statement, unmatchedCount: 1 },
    lines: base.lines.map((l) => (l.suggestion ? { ...l, matchStatus: 'MATCHED', matched: l.suggestion, suggestion: null } : l)),
    uncleared: [ledger('3', '-200.00', '2026-10-10')],
  });
});

describe('StatementWorkspace (Step 6)', () => {
  it('leads with the numbers, accepts the suggested matches, and holds Reconcile until balanced', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StatementWorkspace id="st1" />);

    expect(await screen.findByText("Bank's closing balance")).toBeInTheDocument();
    expect(screen.getByText('3 lines to match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeDisabled();

    const lines = screen.getByRole('table', { name: 'Statement lines' });
    expect(within(lines).getByText('Suggested: JE-1 · Oct 1, 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Accept 2 matches' }));
    expect(bankStatementsApi.acceptSuggestions).toHaveBeenCalledWith('st1');
    expect(await within(lines).findAllByText('Matched')).toHaveLength(2);

    // The charge has no ledger counterpart: Match offers nothing of that amount; Post is the way.
    const charge = within(lines).getByRole('row', { name: /Monthly charge/ });
    await user.click(within(charge).getByRole('button', { name: 'Match' }));
    expect(await screen.findByText(/No unmatched ledger entry has this amount/)).toBeInTheDocument();
  });
});
