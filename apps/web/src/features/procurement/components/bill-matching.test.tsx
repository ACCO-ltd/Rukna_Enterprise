import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { sessionStore } from '@/features/auth/session/session-store';

import type { BillMatchResult, SupplierBill } from '../types';
import { canPostBill } from '../quantities';

/**
 * The matching OUTCOME surface (Slice ④, D6). Matching is a silent control that auto-runs on
 * submit, so these tests are about what the user is shown *after* the verdict, and what they
 * are allowed to conclude and do:
 *
 *  - a healthy bill shows a quiet "Matched — ready" line and the PO / receipts / bill
 *    reconciliation, with NO run button anywhere;
 *  - an exception shows a ⚠ banner and a "Review differences" reveal, gated resolution;
 *  - the posting gate (canPostBill) still blocks EXCEPTION and NOT_RUN.
 */

const mocks = vi.hoisted(() => ({
  useBillMatch: vi.fn(),
  useApproveMatchException: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);

import { BillMatchSummary } from './bill-matching';

function makeBill(overrides: Partial<SupplierBill> = {}): SupplierBill {
  return {
    id: 'bill-1',
    billNumber: 'BILL-000001',
    supplierId: 'sup-1',
    supplier: { id: 'sup-1', code: 'SUP-001', name: 'ABC Trading' },
    supplierInvoiceNumber: 'INV-9044',
    billDate: '2026-08-31T00:00:00.000Z',
    dueDate: '2026-09-30T00:00:00.000Z',
    currencyCode: 'USD',
    documentStatus: 'SUBMITTED',
    postingStatus: 'NOT_POSTED',
    matchStatus: 'MATCHED',
    purchaseOrderId: 'po-1',
    purchaseOrderRevisionId: 'rev-1',
    projectId: null,
    subtotal: '2850.00',
    vatAmount: '0.00',
    totalAmount: '2850.00',
    outstandingAmount: '2850.00',
    lines: [],
    ...overrides,
  };
}

function makeMatch(overrides: Partial<BillMatchResult> = {}): BillMatchResult {
  return {
    id: 'match-1',
    supplierBillId: 'bill-1',
    matchType: 'THREE_WAY',
    status: 'MATCHED',
    matchedAt: '2026-08-31T10:00:00.000Z',
    matchedBy: 'user-1',
    approvalReason: null,
    approvedBy: null,
    approvedAt: null,
    lines: [
      {
        id: 'ml-1',
        purchaseOrderLineId: 'pol-1',
        goodsReceiptLineId: 'grl-1',
        description: null,
        poQuantity: '285',
        receivedQuantity: '285',
        billedQuantity: '285',
        poUnitPrice: '10.00',
        billedUnitPrice: '10.00',
        quantityVariance: '0',
        priceVariance: '0.00',
        amountVariance: '0.00',
        quantityWithinTolerance: true,
        priceWithinTolerance: true,
        amountWithinTolerance: true,
        withinTolerance: true,
        exceptionReason: null,
        purchaseOrderLine: { lineNumber: 1, description: '50kg cement bags' },
      },
    ],
    ...overrides,
  };
}

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false, error: null };

beforeEach(() => {
  sessionStore.setSession({
    accessToken: 'test-token',
    user: {
      id: 'user-1',
      email: 'controller@acco.test',
      orgId: 'org-1',
      tenantSlug: 'acco',
      roles: ['FINANCE_CONTROLLER'],
      permissions: ['approve:matching-exception'],
    },
  });
  vi.clearAllMocks();
  mocks.useApproveMatchException.mockReturnValue(idleMutation);
  mocks.useBillMatch.mockReturnValue({ data: null, isPending: false, isError: false });
});

describe('canPostBill — matching gate (unchanged by D6)', () => {
  it('blocks NOT_RUN and EXCEPTION on a PO-backed bill', () => {
    expect(canPostBill('NOT_RUN', true)).toBe(false);
    expect(canPostBill('EXCEPTION', true)).toBe(false);
  });

  it.each([
    ['MATCHED', true],
    ['MATCHED_WITH_TOLERANCE', true],
    ['APPROVED_EXCEPTION', true],
  ] as const)('%s → postable: %s', (status, expected) => {
    expect(canPostBill(status, true)).toBe(expected);
  });

  it('does not gate a bill with no purchase order', () => {
    expect(canPostBill('NOT_RUN', false)).toBe(true);
  });
});

describe('BillMatchSummary — non-PO bill', () => {
  it('says matching is not applicable and shows no run control', () => {
    renderWithProviders(
      <BillMatchSummary
        bill={makeBill({ purchaseOrderId: null, purchaseOrderRevisionId: null })}
      />,
    );

    expect(screen.getByText(/not matched/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('BillMatchSummary — healthy (D6, silent)', () => {
  it('shows a quiet Matched-ready line and the PO / receipts / bill reconciliation, no run button', () => {
    mocks.useBillMatch.mockReturnValue({ data: makeMatch(), isPending: false, isError: false });

    renderWithProviders(<BillMatchSummary bill={makeBill({ matchStatus: 'MATCHED' })} />);

    expect(screen.getByText(/ready for payment/i)).toBeInTheDocument();
    expect(screen.getByText('PO applicable')).toBeInTheDocument();
    expect(screen.getByText('Accepted receipts')).toBeInTheDocument();
    // 285 × $10.00 = $2,850.00, agreeing across all three figures.
    expect(screen.getAllByText(/2,850\.00/).length).toBeGreaterThanOrEqual(2);
    // The D6 rule: no "Run matching" anywhere.
    expect(screen.queryByRole('button', { name: /run/i })).not.toBeInTheDocument();
    // Nothing to review on a healthy bill.
    expect(
      screen.queryByRole('button', { name: /review differences/i }),
    ).not.toBeInTheDocument();
  });

  it('names who cleared an approved exception, still ready', () => {
    mocks.useBillMatch.mockReturnValue({
      data: makeMatch({
        status: 'APPROVED_EXCEPTION',
        approvedBy: 'jane.controller',
        approvedAt: '2026-09-01T00:00:00.000Z',
      }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(
      <BillMatchSummary bill={makeBill({ matchStatus: 'APPROVED_EXCEPTION' })} />,
    );

    expect(screen.getByText(/jane\.controller/)).toBeInTheDocument();
    expect(screen.getByText(/ready for payment/i)).toBeInTheDocument();
  });
});

describe('BillMatchSummary — exception (D6, Review differences)', () => {
  function exceptionMatch(): BillMatchResult {
    return makeMatch({
      status: 'EXCEPTION',
      lines: [
        {
          ...makeMatch().lines[0]!,
          billedQuantity: '300',
          quantityVariance: '15',
          quantityWithinTolerance: false,
          withinTolerance: false,
          exceptionReason: 'Bill exceeds accepted quantity by 15 bags',
        },
      ],
    });
  }

  it('shows the variance banner and hides the comparison until Review differences is opened', () => {
    mocks.useBillMatch.mockReturnValue({
      data: exceptionMatch(),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchSummary bill={makeBill({ matchStatus: 'EXCEPTION' })} />);

    // The ⚠ line names the variance from the server's reason.
    expect(
      screen.getByText(/exceeds accepted quantity by 15 bags/i),
    ).toBeInTheDocument();
    // The comparison table is not shown yet.
    expect(screen.queryByText('50kg cement bags')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review differences' })).toBeInTheDocument();
  });

  it('reveals the per-line comparison when Review differences is clicked', async () => {
    const user = userEvent.setup();
    mocks.useBillMatch.mockReturnValue({
      data: exceptionMatch(),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchSummary bill={makeBill({ matchStatus: 'EXCEPTION' })} />);
    await user.click(screen.getByRole('button', { name: 'Review differences' }));

    expect(screen.getByText('50kg cement bags')).toBeInTheDocument();
    // Word-first verdict for the failing line.
    expect(screen.getByText('Outside tolerance')).toBeInTheDocument();
  });

  it('offers the real exception approval only to a holder of the permission', () => {
    mocks.useBillMatch.mockReturnValue({
      data: exceptionMatch(),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchSummary bill={makeBill({ matchStatus: 'EXCEPTION' })} />);
    expect(screen.getByRole('button', { name: 'Approve exception' })).toBeInTheDocument();
  });

  it('does not offer exception approval without the permission', () => {
    sessionStore.setSession({
      accessToken: 'test-token',
      user: {
        id: 'user-2',
        email: 'clerk@acco.test',
        orgId: 'org-1',
        tenantSlug: 'acco',
        roles: ['AP_CLERK'],
        permissions: ['manage:payable'],
      },
    });
    mocks.useBillMatch.mockReturnValue({
      data: exceptionMatch(),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchSummary bill={makeBill({ matchStatus: 'EXCEPTION' })} />);
    expect(
      screen.queryByRole('button', { name: 'Approve exception' }),
    ).not.toBeInTheDocument();
    // But anyone may still review the differences.
    expect(screen.getByRole('button', { name: 'Review differences' })).toBeInTheDocument();
  });

  it('requires a reason before an exception can be approved', async () => {
    const user = userEvent.setup();
    const approve = { ...idleMutation, mutate: vi.fn() };
    mocks.useApproveMatchException.mockReturnValue(approve);
    mocks.useBillMatch.mockReturnValue({
      data: exceptionMatch(),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<BillMatchSummary bill={makeBill({ matchStatus: 'EXCEPTION' })} />);
    await user.click(screen.getByRole('button', { name: 'Approve exception' }));

    const confirm = screen.getAllByRole('button', { name: 'Approve exception' }).at(-1)!;
    expect(confirm).toBeDisabled();

    await user.type(
      screen.getByLabelText('Approval Reason'),
      'Agreed short delivery with supplier',
    );
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(approve.mutate).toHaveBeenCalledWith(
      { billId: 'bill-1', payload: { approvalReason: 'Agreed short delivery with supplier' } },
      expect.anything(),
    );
  });
});
