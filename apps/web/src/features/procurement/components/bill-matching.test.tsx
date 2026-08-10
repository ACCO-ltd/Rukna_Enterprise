import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { BillMatchResult, BillMatchStatus, SupplierBill } from '../types';
import { canPostBill } from '../quantities';

/**
 * The Matching tab carries a financial control, so the tests are about what a user is
 * allowed to conclude from it.
 *
 * The most important assertion in this file is the one about `NOT_RUN`: the UI blocks it
 * and the server does not (P15). If someone later "fixes" the frontend to agree with the
 * server, an unmatched bill becomes postable with no warning anywhere — so the divergence
 * is pinned by a test that names it.
 */

const mocks = vi.hoisted(() => ({
  useBillMatch: vi.fn(),
  useRunBillMatch: vi.fn(),
  useApproveMatchException: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);

import { BillMatchingTab } from './bill-matching';

function makeBill(overrides: Partial<SupplierBill> = {}): SupplierBill {
  return {
    id: 'bill-1',
    billNumber: 'BILL-000001',
    supplierId: 'sup-1',
    supplier: { id: 'sup-1', code: 'SUP-001', name: 'Al-Rashid Trading' },
    supplierInvoiceNumber: 'INV-2026-0042',
    billDate: '2026-08-19T00:00:00.000Z',
    dueDate: '2026-09-19T00:00:00.000Z',
    currencyCode: 'SAR',
    // The two real status axes. This fixture carried a single `status: 'DRAFT'` until Tier B,
    // and `SupplierBill` has no such column — so the type and the fixture agreed with each
    // other while both disagreed with the API, and the badge rendered blank in production.
    documentStatus: 'DRAFT',
    postingStatus: 'NOT_POSTED',
    matchStatus: 'NOT_RUN',
    purchaseOrderId: 'po-1',
    purchaseOrderRevisionId: 'rev-1',
    projectId: null,
    subtotal: '19550.00',
    vatAmount: '2932.50',
    totalAmount: '22482.50',
    outstandingAmount: '22482.50',
    lines: [
      {
        id: 'bl-1',
        lineNumber: 1,
        description: '12mm rebar',
        quantity: '23',
        unitPrice: '855.00',
        netAmount: '19665.00',
        vatAmount: '2949.75',
        grossAmount: '22614.75',
        expenseProfileCode: 'MATERIAL_PURCHASE',
        projectId: null,
        boqNodeId: null,
      },
    ],
    ...overrides,
  };
}

function makeMatch(overrides: Partial<BillMatchResult> = {}): BillMatchResult {
  return {
    id: 'match-1',
    supplierBillId: 'bill-1',
    matchType: 'THREE_WAY',
    status: 'MATCHED_WITH_TOLERANCE',
    matchedAt: '2026-08-19T10:00:00.000Z',
    matchedBy: 'user-1',
    approvalReason: null,
    approvedBy: null,
    approvedAt: null,
    lines: [
      {
        id: 'ml-1',
        purchaseOrderLineId: 'pol-1',
        goodsReceiptLineId: 'grl-1',
        description: '12mm Rebar',
        poQuantity: '25',
        receivedQuantity: '23',
        billedQuantity: '23',
        poUnitPrice: '850.00',
        billedUnitPrice: '855.00',
        quantityVariance: '0',
        priceVariance: '5.00',
        amountVariance: '115.00',
        withinTolerance: true,
      },
    ],
    ...overrides,
  };
}

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useRunBillMatch.mockReturnValue(idleMutation);
  mocks.useApproveMatchException.mockReturnValue(idleMutation);
  mocks.useBillMatch.mockReturnValue({ data: null, isPending: false, isError: false });
});

describe('canPostBill — the gate is stricter than the server (P15)', () => {
  it('blocks NOT_RUN even though POSTABLE_MATCH_STATUSES permits it', () => {
    // supplier-bill.service.ts:149 lists NOT_RUN as postable. §6.31 and §12.8 both say
    // it must not be. This UI implements the documented rule; do not "fix" it to match
    // the server without fixing the server.
    expect(canPostBill('NOT_RUN', true)).toBe(false);
  });

  it.each<[BillMatchStatus, boolean]>([
    ['MATCHED', true],
    ['MATCHED_WITH_TOLERANCE', true],
    ['APPROVED_EXCEPTION', true],
    ['EXCEPTION', false],
  ])('%s → postable: %s', (status, expected) => {
    expect(canPostBill(status, true)).toBe(expected);
  });

  it('does not gate a bill with no purchase order', () => {
    expect(canPostBill('NOT_RUN', false)).toBe(true);
  });
});

describe('BillMatchingTab — not yet run', () => {
  it('offers to run matching and names the match type from the bill lines', () => {
    renderWithProviders(<BillMatchingTab bill={makeBill()} />);

    expect(screen.getByText('Matching has not been run')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Matching' })).toBeInTheDocument();
    expect(screen.getByText(/three-way matching/i)).toBeInTheDocument();
  });

  it('runs matching for the bill when asked', async () => {
    const user = userEvent.setup();
    const run = { ...idleMutation, mutate: vi.fn() };
    mocks.useRunBillMatch.mockReturnValue(run);

    renderWithProviders(<BillMatchingTab bill={makeBill()} />);
    await user.click(screen.getByRole('button', { name: 'Run Matching' }));

    expect(run.mutate).toHaveBeenCalledWith('bill-1');
  });

  it('does not offer to run when the bill has no purchase order link', () => {
    renderWithProviders(
      <BillMatchingTab
        bill={makeBill({ purchaseOrderId: null, purchaseOrderRevisionId: null })}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Run Matching' })).not.toBeInTheDocument();
    expect(screen.getByText(/not linked to a purchase order/i)).toBeInTheDocument();
  });
});

describe('BillMatchingTab — results', () => {
  it('renders the variance row with both prices and the tolerance verdict', () => {
    mocks.useBillMatch.mockReturnValue({
      data: makeMatch(),
      isPending: false,
      isError: false,
    });

    renderWithProviders(
      <BillMatchingTab bill={makeBill({ matchStatus: 'MATCHED_WITH_TOLERANCE' })} />,
    );

    expect(screen.getByText('12mm Rebar')).toBeInTheDocument();
    expect(screen.getByText(/850\.00/)).toBeInTheDocument();
    expect(screen.getByText(/855\.00/)).toBeInTheDocument();
    expect(screen.getByText('Within tolerance')).toBeInTheDocument();
  });

  it('states tolerance in words, not only as a symbol', () => {
    mocks.useBillMatch.mockReturnValue({
      data: makeMatch({
        lines: [{ ...makeMatch().lines[0]!, withinTolerance: false }],
      }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchingTab bill={makeBill({ matchStatus: 'EXCEPTION' })} />);

    // Someone who cannot see the glyph still gets the verdict.
    expect(screen.getByText('Outside tolerance')).toBeInTheDocument();
  });

  it('shows the blocking banner on EXCEPTION', () => {
    mocks.useBillMatch.mockReturnValue({
      data: makeMatch({ status: 'EXCEPTION' }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchingTab bill={makeBill({ matchStatus: 'EXCEPTION' })} />);

    expect(screen.getByText(/posting is blocked/i)).toBeInTheDocument();
  });

  it('offers exception approval only on EXCEPTION', () => {
    mocks.useBillMatch.mockReturnValue({
      data: makeMatch({ status: 'MATCHED' }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchingTab bill={makeBill({ matchStatus: 'MATCHED' })} />);

    expect(
      screen.queryByRole('button', { name: 'Approve Exception' }),
    ).not.toBeInTheDocument();
  });

  it('requires a reason before an exception can be approved', async () => {
    const user = userEvent.setup();
    const approve = { ...idleMutation, mutate: vi.fn() };
    mocks.useApproveMatchException.mockReturnValue(approve);
    mocks.useBillMatch.mockReturnValue({
      data: makeMatch({ status: 'EXCEPTION' }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchingTab bill={makeBill({ matchStatus: 'EXCEPTION' })} />);
    await user.click(screen.getByRole('button', { name: 'Approve Exception' }));

    const confirm = screen.getAllByRole('button', { name: 'Approve Exception' }).at(-1)!;
    expect(confirm).toBeDisabled();

    await user.type(
      screen.getByLabelText('Approval Reason'),
      'Price variance within CFO approved limit',
    );
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(approve.mutate).toHaveBeenCalledWith(
      {
        billId: 'bill-1',
        payload: { approvalReason: 'Price variance within CFO approved limit' },
      },
      expect.anything(),
    );
  });

  it('renders in Arabic without a missing key', () => {
    mocks.useBillMatch.mockReturnValue({
      data: makeMatch(),
      isPending: false,
      isError: false,
    });

    renderWithProviders(
      <BillMatchingTab bill={makeBill({ matchStatus: 'MATCHED_WITH_TOLERANCE' })} />,
      { locale: 'ar' },
    );

    expect(screen.getByText('مطابقة الفاتورة')).toBeInTheDocument();
  });
});
