import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectLedgerResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * The ledger is a drill-down, not an authoring surface.
 *
 * Its two disciplines: totals come from the server over the whole filtered set (summing the
 * visible page would be wrong on page two), and the empty side of a posting reads as an em dash
 * rather than $0.00, which is what makes a ledger scannable.
 */
const hookMocks = vi.hoisted(() => ({
  useProjectLedger: vi.fn(),
  useFinanceOverview: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({ useProject: vi.fn() }));

vi.mock('../hooks/use-finance', () => hookMocks);
vi.mock('@/features/projects/hooks/use-project', () => projectMocks);

import { LedgerView } from './ledger-view';

function ledger(over: Partial<ProjectLedgerResponse> = {}): ProjectLedgerResponse {
  return {
    projectId: 'p1',
    fromDate: '2025-03-01',
    toDate: '2026-09-06',
    total: 48,
    limit: 25,
    offset: 0,
    totalRevenue: '720000.00',
    totalCost: '465000.00',
    lines: [
      {
        journalEntryId: 'j1',
        journalNumber: 'JE-000021',
        accountingDate: '2026-09-05',
        documentDate: '2026-09-05',
        description: 'Supplier Bill — SB-0021',
        lineDescription: 'Concrete supply, Site A',
        entryPurpose: 'NORMAL',
        accountId: 'a1',
        accountCode: '50303',
        accountName: 'Cement Cost',
        debitAmount: '12000.00',
        creditAmount: '0.00',
        sourceDocumentType: 'SUPPLIER_BILL',
        sourceDocumentId: 'bill-1',
        boqNodeId: 'n-32',
        spendCategoryId: null,
        supplierId: 's1',
        clientId: null,
        contractId: null,
      },
    ],
    ...over,
  };
}

const overview = (available: boolean) => ({
  data: {
    accountingPosition: { available, blockers: [] },
    period: null,
  },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  projectMocks.useProject.mockReturnValue({
    data: { id: 'p1', startDate: '2025-03-01' },
    isPending: false,
    isError: false,
  });
  hookMocks.useFinanceOverview.mockReturnValue(overview(true));
});

describe('LedgerView', () => {
  it('lists postings with their source, and never offers journal authoring', () => {
    hookMocks.useProjectLedger.mockReturnValue({
      data: ledger(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<LedgerView projectId="p1" />);

    expect(screen.getByText('JE-000021')).toBeInTheDocument();
    expect(screen.getByText('Supplier bill')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new journal/i })).not.toBeInTheDocument();
  });

  /** Summing the visible page and calling it a total would be wrong on page two. */
  it('shows server totals over the whole filtered set, not the page', () => {
    hookMocks.useProjectLedger.mockReturnValue({
      data: ledger(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<LedgerView projectId="p1" />);

    expect(screen.getByText('Revenue in range')).toBeInTheDocument();
    expect(screen.getByText(/720,000/)).toBeInTheDocument();
    // 48 entries in total, one on this page.
    expect(screen.getByText('48')).toBeInTheDocument();
  });

  it('renders the empty side of a posting as a dash rather than a zero', () => {
    hookMocks.useProjectLedger.mockReturnValue({
      data: ledger(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<LedgerView projectId="p1" />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('opens the journal behind a row, showing only the attribution that exists', async () => {
    const user = userEvent.setup();
    hookMocks.useProjectLedger.mockReturnValue({
      data: ledger(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<LedgerView projectId="p1" />);

    await user.click(screen.getByText('Concrete supply, Site A'));

    expect(screen.getByText('Journal entry')).toBeInTheDocument();
    expect(screen.getByText('Project attribution')).toBeInTheDocument();
    expect(screen.getByText('BOQ item')).toBeInTheDocument();
    // This line has no spend category; an empty row would imply someone failed to fill it in.
    expect(screen.queryByText('Spend category')).not.toBeInTheDocument();
  });

  it('reports the ledger as unavailable when accounting is not configured', () => {
    hookMocks.useFinanceOverview.mockReturnValue(overview(false));
    hookMocks.useProjectLedger.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<LedgerView projectId="p1" />);

    expect(screen.getByText('Ledger unavailable')).toBeInTheDocument();
  });

  it('distinguishes an empty range from a search that matched nothing', () => {
    hookMocks.useProjectLedger.mockReturnValue({
      data: ledger({ lines: [], total: 0 }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<LedgerView projectId="p1" />);

    expect(
      screen.getByText('No posted entries carry this project in this range.'),
    ).toBeInTheDocument();
  });
});
