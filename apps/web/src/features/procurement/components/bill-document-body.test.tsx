import { screen } from '@testing-library/react';
import { SummaryRail } from '@erp/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { BillActivityEntry, BillApprovals, BillPayments, SupplierBill } from '../types';

const mocks = vi.hoisted(() => ({
  approvals: undefined as BillApprovals | undefined,
  activity: undefined as BillActivityEntry[] | undefined,
  payments: undefined as BillPayments | undefined,
}));

vi.mock('../hooks/use-procurement', () => ({
  useSupplierBillApprovals: () => ({ isPending: false, isError: false, data: mocks.approvals }),
  useSupplierBillActivity: () => ({ isPending: false, isError: false, data: mocks.activity }),
  useSupplierBillPayments: () => ({ isPending: false, isError: false, data: mocks.payments }),
  useGoodsReceipts: () => ({ isPending: false, data: [] }),
  usePurchaseOrder: () => ({ isPending: false, data: undefined }),
}));

import { BillActivityTab, BillApprovalsTab, useBillSummary } from './bill-document-body';

const BILL = {
  id: 'bill-1',
  currencyCode: 'USD',
  postingStatus: 'POSTED',
  outstandingAmount: '4260.00',
  dueDate: '2026-10-14',
  postedAt: '2026-09-16T10:42:00Z',
} as unknown as SupplierBill;

function Summary({ bill }: { bill: SupplierBill }) {
  return <SummaryRail title="Payment summary" rows={useBillSummary(bill)} />;
}

beforeEach(() => {
  mocks.approvals = undefined;
  mocks.activity = undefined;
  mocks.payments = undefined;
});

describe('BillApprovalsTab (ADR-036)', () => {
  it('shows the chain with who approved, their comment, and the step still waiting', () => {
    mocks.approvals = {
      directApproval: null,
      instances: [
        {
          id: 'ai-1',
          status: 'PENDING',
          policyName: 'Bills from $5,000 to $25,000',
          initiatedAt: '2026-09-14T10:20:00Z',
          initiatedBy: { id: 'u1', name: 'Faarax Nuur' },
          evaluatedAmount: '5660.00',
          steps: [
            { stepOrder: 1, roleRequired: 'FINANCE_MANAGER', isOptional: false, state: 'APPROVED', actor: { id: 'u2', name: 'Hodan Abdi' }, actedAt: '2026-09-15T09:12:00Z', notes: 'Quantities checked against GRN-2026-0154.' },
            { stepOrder: 2, roleRequired: 'COMMERCIAL_DIRECTOR', isOptional: false, state: 'CURRENT', actor: null, actedAt: null, notes: null },
          ],
        },
      ],
    };
    renderWithProviders(<BillApprovalsTab bill={BILL} />);
    expect(screen.getByText(/Bills from \$5,000 to \$25,000 · evaluated at \$5,660\.00/)).toBeInTheDocument();
    expect(screen.getByText('Finance manager')).toBeInTheDocument();
    expect(screen.getByText('Commercial director')).toBeInTheDocument();
    expect(screen.getAllByText(/Hodan Abdi/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Quantities checked against GRN-2026-0154/)).toBeInTheDocument();
  });

  it('says who approved directly when no policy applied', () => {
    mocks.approvals = {
      instances: [],
      directApproval: { actor: { id: 'u2', name: 'Hodan Abdi' }, at: '2026-09-15T09:12:00Z' },
    };
    renderWithProviders(<BillApprovalsTab bill={BILL} />);
    expect(screen.getByText(/Approved directly by Hodan Abdi/)).toBeInTheDocument();
  });

  it('says nothing has been requested yet for a draft', () => {
    mocks.approvals = { instances: [], directApproval: null };
    renderWithProviders(<BillApprovalsTab bill={BILL} />);
    expect(screen.getByText('No approval has been requested for this bill yet.')).toBeInTheDocument();
  });
});

describe('BillActivityTab (ADR-036)', () => {
  it('words each event and keeps its machine code, including approvals by role', () => {
    mocks.activity = [
      { id: '3', at: '2026-09-16T10:42:00Z', actor: { id: 'u2', name: 'Hodan Abdi' }, code: 'bills.post' },
      { id: '2', at: '2026-09-15T09:12:00Z', actor: { id: 'u2', name: 'Hodan Abdi' }, code: 'approval.approve', detail: 'FINANCE_MANAGER' },
      { id: '1', at: '2026-09-14T10:05:00Z', actor: { id: 'u1', name: 'Faarax Nuur' }, code: 'bills.create' },
      { id: '0', at: '2026-09-14T10:04:00Z', actor: { id: 'u1', name: 'Faarax Nuur' }, code: 'bills.archive' },
    ];
    renderWithProviders(<BillActivityTab bill={BILL} />);
    expect(screen.getByText(/posted the bill to the general ledger/)).toBeInTheDocument();
    expect(screen.getByText(/approved as Finance manager/)).toBeInTheDocument();
    expect(screen.getByText(/created the bill/)).toBeInTheDocument();
    // An event the client has no words for still appears, by its code.
    expect(screen.getByText(/recorded bills\.archive/)).toBeInTheDocument();
    expect(screen.getByText(/bills\.post/)).toBeInTheDocument();
  });

  it('words return, reject and edit, and quotes the reason a return or rejection gave', () => {
    mocks.activity = [
      { id: '3', at: '2026-09-21T10:00:00Z', actor: { id: 'u2', name: 'Hodan Abdi' }, code: 'bills.reject', reason: 'Duplicate of BILL-2026-0040.' },
      { id: '2', at: '2026-09-20T11:00:00Z', actor: { id: 'u1', name: 'Faarax Nuur' }, code: 'bills.update' },
      { id: '1', at: '2026-09-20T10:00:00Z', actor: { id: 'u2', name: 'Hodan Abdi' }, code: 'bills.return', reason: 'Amount is $5,060, not $5,660.' },
    ];
    renderWithProviders(<BillActivityTab bill={BILL} />);
    expect(screen.getByText(/returned the bill for correction/)).toBeInTheDocument();
    expect(screen.getByText(/rejected the bill/)).toBeInTheDocument();
    expect(screen.getByText(/edited the bill/)).toBeInTheDocument();
    expect(screen.getByText('— “Amount is $5,060, not $5,660.”')).toBeInTheDocument();
    expect(screen.getByText('— “Duplicate of BILL-2026-0040.”')).toBeInTheDocument();
  });
});

describe('bill summary rail (ADR-036)', () => {
  it('shows the server’s paid and pending amounts and the payment count', () => {
    mocks.payments = { paidAmount: '1000.00', pendingAmount: '400.00', paymentCount: 1, allocations: [] };
    renderWithProviders(<Summary bill={BILL} />);
    expect(screen.getByText('Amount paid')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('In unposted payments')).toBeInTheDocument();
    expect(screen.getByText('$400.00')).toBeInTheDocument();
    expect(screen.getByText('$4,260.00')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('leaves out the pending line when nothing is pending', () => {
    mocks.payments = { paidAmount: '0.00', pendingAmount: '0.00', paymentCount: 0, allocations: [] };
    renderWithProviders(<Summary bill={BILL} />);
    expect(screen.queryByText('In unposted payments')).toBeNull();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });
});
