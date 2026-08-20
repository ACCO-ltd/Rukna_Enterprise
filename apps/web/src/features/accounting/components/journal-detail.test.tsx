import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import {
  approveJournal,
  getJournal,
  listAccounts,
  postJournal,
  reverseJournal,
  submitJournal,
} from '@/features/accounting/api/accounting-api';
import { ApiError } from '@/lib/api-client';
import type {
  Account,
  JournalEntry,
  JournalLine,
  JournalStatus,
} from '@/features/accounting/types';

import { JournalDetail } from './journal-detail';

vi.mock('@/features/accounting/api/accounting-api', () => ({
  getJournal: vi.fn(),
  listAccounts: vi.fn(),
  submitJournal: vi.fn(),
  approveJournal: vi.fn(),
  postJournal: vi.fn(),
  reverseJournal: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function account(): Account {
  return {
    id: 'acc-expense',
    organizationId: 'org-1',
    code: '60100',
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [
      {
        id: 'ver-1',
        accountId: 'acc-expense',
        versionNumber: 1,
        name: 'Office Expense',
        parentAccountId: null,
        accountClass: 'EXPENSE',
        accountSubtype: 'ADMINISTRATIVE_EXPENSE',
        isPostingAllowed: true,
        isControlAccount: false,
        controlledSubledgerType: null,
        controlPostingPolicy: 'UNRESTRICTED',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  };
}

/** A DRAFT line: the account snapshots are empty until the posting engine fills them. */
function draftLine(overrides: Partial<JournalLine> = {}): JournalLine {
  return {
    id: 'line-1',
    journalEntryId: 'jrn-1',
    lineNumber: 1,
    accountId: 'acc-expense',
    accountVersionId: null,
    accountCodeSnapshot: '',
    accountNameSnapshot: '',
    accountVersionNumber: 0,
    debitAmount: '2500.00',
    creditAmount: '0.00',
    transactionCurrencyCode: 'USD',
    baseCurrencyAmount: '2500.00',
    description: 'Rent expense',
    projectId: null,
    departmentId: null,
    costCenterId: null,
    ...overrides,
  };
}

function journal(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'jrn-1',
    organizationId: 'org-1',
    journalNumber: 'JE-000001',
    accountingPeriodId: 'per-1',
    journalCategory: 'GENERAL',
    entryPurpose: 'NORMAL',
    status: 'DRAFT',
    documentDate: '2026-01-15',
    accountingDate: '2026-01-15',
    postedAt: null,
    description: 'January office rent',
    currencyCode: 'USD',
    sourceDocumentType: 'MANUAL_JOURNAL',
    sourceDocumentId: 'draft-1',
    reversalOfJournalEntryId: null,
    createdBy: 'user-abcd1234',
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    postedBy: null,
    createdAt: '2026-01-15T00:00:00.000Z',
    lines: [
      draftLine(),
      draftLine({
        id: 'line-2',
        lineNumber: 2,
        debitAmount: '0.00',
        creditAmount: '2500.00',
        description: 'Accrued liability',
      }),
    ],
    ...overrides,
  };
}

function withStatus(status: JournalStatus, overrides: Partial<JournalEntry> = {}) {
  return journal({ status, ...overrides });
}

beforeEach(() => {
  vi.mocked(getJournal).mockReset();
  vi.mocked(listAccounts).mockReset();
  vi.mocked(submitJournal).mockReset();
  vi.mocked(approveJournal).mockReset();
  vi.mocked(postJournal).mockReset();
  vi.mocked(reverseJournal).mockReset();

  vi.mocked(listAccounts).mockResolvedValue([account()]);
  vi.mocked(getJournal).mockResolvedValue(journal());
});

function render() {
  return renderWithProviders(<JournalDetail journalId="jrn-1" />);
}

describe('JournalDetail', () => {
  it('leads with the journal value and its description', async () => {
    render();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('$2,500.00');
    expect(screen.getByText('January office rent')).toBeInTheDocument();
  });

  /**
   * A DRAFT's lines carry empty `accountCodeSnapshot` / `accountNameSnapshot` — the posting
   * engine writes them at post time. Without the live lookup the account column would be
   * blank, on the screen where someone decides whether to approve the entry.
   */
  it('names the account on a draft line, whose snapshots are empty', async () => {
    render();

    expect(await screen.findAllByText('60100 — Office Expense')).toHaveLength(2);
  });

  it('prefers the posted snapshot, which survives a later rename', async () => {
    vi.mocked(getJournal).mockResolvedValue(
      withStatus('POSTED', {
        lines: [
          draftLine({ accountCodeSnapshot: '60100', accountNameSnapshot: 'Office Expense (2026)' }),
          draftLine({ id: 'line-2', lineNumber: 2, debitAmount: '0.00', creditAmount: '2500.00' }),
        ],
      }),
    );

    render();

    expect(await screen.findByText('60100 — Office Expense (2026)')).toBeInTheDocument();
  });

  it('totals both columns', async () => {
    render();

    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('Totals')).toBeInTheDocument();
    // Two line amounts plus two totals, all 2,500.
    expect(screen.getAllByText('$2,500.00').length).toBeGreaterThanOrEqual(3);
  });

  describe('lifecycle actions', () => {
    it.each([
      ['DRAFT', 'Submit for approval'],
      ['SUBMITTED', 'Approve'],
      ['APPROVED', 'Post to the ledger'],
      ['POSTED', 'Reverse'],
    ] as const)('offers %s exactly what the server accepts', async (status, label) => {
      vi.mocked(getJournal).mockResolvedValue(withStatus(status));
      render();

      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    });

    it('offers nothing on a reversed journal', async () => {
      vi.mocked(getJournal).mockResolvedValue(withStatus('REVERSED'));
      render();

      expect(await screen.findByText('No action is available from this status.')).toBeInTheDocument();
    });

    it('submits after confirmation', async () => {
      const user = userEvent.setup();
      vi.mocked(submitJournal).mockResolvedValue(withStatus('SUBMITTED'));

      render();
      await user.click(await screen.findByRole('button', { name: 'Submit for approval' }));
      await user.click(screen.getByRole('button', { name: 'Submit for approval', hidden: false }));

      expect(vi.mocked(submitJournal)).toHaveBeenCalledWith('jrn-1');
    });

    it('sends a rejection with its reason, which the server requires', async () => {
      const user = userEvent.setup();
      vi.mocked(getJournal).mockResolvedValue(withStatus('SUBMITTED'));
      vi.mocked(approveJournal).mockResolvedValue(withStatus('REJECTED'));

      render();
      await user.click(await screen.findByRole('button', { name: 'Reject' }));

      await user.type(screen.getByLabelText('Rejection reason'), 'Wrong account used');
      await user.click(screen.getByRole('button', { name: 'Reject', hidden: false }));

      expect(vi.mocked(approveJournal)).toHaveBeenCalledWith('jrn-1', {
        approved: false,
        rejectionReason: 'Wrong account used',
      });
    });

    /**
     * §6.17 draws `REJECTED → DRAFT`, but no endpoint performs that transition and `submit`
     * accepts a REJECTED journal directly. Offering nothing would strand it.
     */
    it('lets a rejected journal be resubmitted', async () => {
      vi.mocked(getJournal).mockResolvedValue(
        withStatus('REJECTED', { rejectionReason: 'Wrong account used' }),
      );

      render();

      expect(await screen.findByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
      expect(screen.getByText(/Wrong account used/)).toBeInTheDocument();
    });
  });

  describe('an unbalanced journal', () => {
    const unbalanced = () =>
      withStatus('SUBMITTED', {
        lines: [
          draftLine({ debitAmount: '2500.00', creditAmount: '0.00' }),
          draftLine({ id: 'line-2', lineNumber: 2, debitAmount: '0.00', creditAmount: '2400.00' }),
        ],
      });

    /**
     * Nothing is checked until posting, so a journal can be saved, submitted and approved
     * while out of balance. This screen is where a reviewer can catch it before approving.
     */
    it('warns that the debits and credits do not agree', async () => {
      vi.mocked(getJournal).mockResolvedValue(unbalanced());
      render();

      expect(await screen.findByText(/do not agree/)).toBeInTheDocument();
      expect(screen.getByText(/\$2,500\.00 against \$2,400\.00/)).toBeInTheDocument();
    });

    it('will not offer to post it', async () => {
      vi.mocked(getJournal).mockResolvedValue(
        withStatus('APPROVED', { lines: unbalanced().lines }),
      );

      render();

      expect(await screen.findByRole('button', { name: 'Post to the ledger' })).toBeDisabled();
    });

    it('says nothing when the two agree', async () => {
      render();

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText(/do not agree/)).not.toBeInTheDocument();
    });
  });

  it('reports a missing journal distinctly from a failure', async () => {
    vi.mocked(getJournal).mockRejectedValue(new ApiError(404, 'gone', 'NOT_FOUND'));
    render();

    expect(await screen.findByText('This journal no longer exists.')).toBeInTheDocument();
  });

});
