import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { CommitmentLedgerEntry } from '../types';

/**
 * The commitment ledger: one project at a time, Ordered / Received / Billed as a segmented view
 * over the COMMITTED / ACCRUED / ACTUAL stages, a metric strip of the position, and each entry
 * with its document, supplier and what it is charged to. Money-blind roles see one hidden state.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ isPending: false, data: [{ id: 'p1', code: 'P-1', name: 'Hodan villa', currency: 'USD' }] }),
}));

const hooks = vi.hoisted(() => ({ entries: vi.fn(), summary: vi.fn() }));
vi.mock('../hooks/use-procurement', () => ({
  useProjectCommitments: (projectId: string, filters?: unknown) => hooks.entries(projectId, filters),
  useProjectCommitmentSummary: (projectId: string) => hooks.summary(projectId),
}));

import { CommitmentLedger } from './commitments';

const MONEY = 'view:commitment-ledger';

const entry = (patch: Partial<CommitmentLedgerEntry> & { id: string }): CommitmentLedgerEntry => ({
  stage: 'COMMITTED',
  amount: '1000.00',
  reportingAmount: '1000.00',
  currencyCode: 'USD',
  sourceDocumentType: 'PURCHASE_ORDER_REVISION',
  sourceDocumentId: 'rev1',
  sourceRevision: 1,
  eventType: 'PO_APPROVED',
  accountingDate: '2026-09-20',
  occurredAt: '2026-09-20T00:00:00Z',
  purchaseOrderId: 'po1',
  spendCategoryId: null,
  projectId: 'p1',
  boqNodeId: null,
  supplierId: 's1',
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  hooks.summary.mockReturnValue({
    isPending: false,
    isError: false,
    data: { committed: '1000.00', accrued: '250.00', actual: '100.00' },
  });
  hooks.entries.mockReturnValue({
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    data: [
      entry({
        id: 'e1',
        documentNumber: 'PO-2026-0007 (Rev 1)',
        supplierName: 'Bakaal Steel',
        boqNode: { id: 'b1', code: '2.1.3', name: 'Slab rebar' },
      }),
      entry({
        id: 'e2',
        reportingAmount: '-250.00',
        sourceDocumentType: 'GOODS_RECEIPT',
        sourceDocumentId: 'grn1',
        documentNumber: 'GRN-2026-0003',
        accountingDate: '2026-09-25',
      }),
    ],
  });
});

describe('CommitmentLedger', () => {
  it('asks for a project first — one empty state, no stage switcher', () => {
    renderWithProviders(<CommitmentLedger />, { permissions: [MONEY] });
    expect(screen.getByText('Choose a project', { selector: 'h2, h3, p' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText(/queried per project/)).not.toBeInTheDocument();
  });

  it('shows the position and the entries with document, supplier, charged-to and signed amounts', async () => {
    renderWithProviders(<CommitmentLedger initialProjectId="p1" />, { permissions: [MONEY] });

    expect(screen.getByText('Cost so far')).toBeInTheDocument();
    expect(screen.getByText('$1,350.00')).toBeInTheDocument();

    const grid = within(await screen.findByRole('table'));
    expect(grid.getByRole('link', { name: 'PO-2026-0007 (Rev 1)' })).toHaveAttribute('href', '/procurement/orders/po1');
    expect(grid.getByText('Bakaal Steel')).toBeInTheDocument();
    expect(grid.getByText('Slab rebar')).toBeInTheDocument();
    expect(grid.getByRole('link', { name: 'GRN-2026-0003' })).toHaveAttribute('href', '/procurement/grn/grn1');
    expect(grid.getByText('Released on receipt')).toBeInTheDocument();
    expect(grid.getByText('($250.00)')).toBeInTheDocument();
    expect(grid.getByText('No BOQ item')).toBeInTheDocument();
  });

  it('renders an empty stage that arrives as a bare number 0 without crashing', () => {
    hooks.summary.mockReturnValue({
      isPending: false,
      isError: false,
      data: { committed: '1000.00', accrued: 0, actual: 0 },
    });
    renderWithProviders(<CommitmentLedger initialProjectId="p1" />, { permissions: [MONEY] });

    expect(screen.getByText('Cost so far')).toBeInTheDocument();
    expect(screen.getAllByText('$1,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
  });

  it('maps Ordered / Received / Billed to the COMMITTED / ACCRUED / ACTUAL stages', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommitmentLedger initialProjectId="p1" />, { permissions: [MONEY] });

    await user.click(screen.getByRole('tab', { name: 'Received' }));
    expect(hooks.entries).toHaveBeenLastCalledWith('p1', { stage: 'ACCRUED' });
    await user.click(screen.getByRole('tab', { name: 'All' }));
    expect(hooks.entries).toHaveBeenLastCalledWith('p1', undefined);
  });

  it('shows one hidden state to a money-blind role and reads nothing', () => {
    renderWithProviders(<CommitmentLedger initialProjectId="p1" />, { permissions: ['view:procurement'] });
    expect(screen.getByText('Cost figures are hidden for your role')).toBeInTheDocument();
    expect(hooks.entries).toHaveBeenCalledWith('', undefined);
  });
});
