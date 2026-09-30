import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNTING_PERMISSIONS, PROCUREMENT_PERMISSIONS } from '@/features/auth/permissions/can';
import { renderWithProviders } from '@/test/render';

import type { BillMatchResult, SupplierBill } from '../types';

/**
 * The bill header's primary command while posting is held by the match (ADR-037). An approved
 * PO bill whose match is an open EXCEPTION has exactly one next step — resolve the exception —
 * so for whoever may resolve it that is the primary button, opening the same dialog Matching
 * uses. The Notice keeps its "Review match" link to the differences.
 */

const mocks = vi.hoisted(() => ({
  useApproveSupplierBill: vi.fn(),
  usePostSupplierBill: vi.fn(),
  useReverseSupplierBill: vi.fn(),
  useSubmitSupplierBill: vi.fn(),
  useReturnSupplierBill: vi.fn(),
  useRejectSupplierBill: vi.fn(),
  useBillMatch: vi.fn(),
  useResolveMatchException: vi.fn(),
  useRunBillMatch: vi.fn(),
  useApproveMatchException: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('next/navigation', () => ({ useRouter: () => routerMocks, usePathname: () => '/finance/accounting/bills/bill-1' }));
vi.mock('@/features/accounting/hooks/use-accounting', () => ({
  useAccounts: () => ({ data: [], isPending: false, isError: false }),
  usePostingProfiles: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/features/workflows/components/gated-action-button', () => ({
  GatedActionButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

import { BillDocumentHeader } from './bill-actions-bar';

const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null };

const BLOCKED = {
  id: 'bill-1',
  billNumber: null,
  supplierId: 'sup-1',
  supplier: { id: 'sup-1', code: 'SUP-001', name: 'ABC Trading' },
  supplierInvoiceNumber: 'INV-9044',
  billDate: '2026-08-31T00:00:00.000Z',
  dueDate: '2026-09-30T00:00:00.000Z',
  currencyCode: 'USD',
  documentStatus: 'APPROVED',
  postingStatus: 'NOT_POSTED',
  matchStatus: 'EXCEPTION',
  purchaseOrderId: 'po-1',
  purchaseOrderRevisionId: 'rev-1',
  projectId: null,
  subtotal: '2850.00',
  vatAmount: '0.00',
  totalAmount: '2850.00',
  outstandingAmount: '2850.00',
  lines: [],
} as unknown as SupplierBill;

const EXCEPTION = { id: 'm1', supplierBillId: 'bill-1', status: 'EXCEPTION', resolutionAction: null, lines: [] } as unknown as BillMatchResult;

const RESOLVER = [PROCUREMENT_PERMISSIONS.approveMatchException, ACCOUNTING_PERMISSIONS.managePayables];

beforeEach(() => {
  vi.clearAllMocks();
  for (const hook of ['useApproveSupplierBill', 'usePostSupplierBill', 'useReverseSupplierBill', 'useSubmitSupplierBill', 'useReturnSupplierBill', 'useRejectSupplierBill', 'useResolveMatchException', 'useRunBillMatch', 'useApproveMatchException'] as const) {
    mocks[hook].mockReturnValue(idle);
  }
  mocks.useBillMatch.mockReturnValue({ data: EXCEPTION, isPending: false, isError: false });
});

describe('BillDocumentHeader — posting blocked by the match', () => {
  it('makes resolving the exception the primary command, opening the resolve dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BillDocumentHeader bill={BLOCKED} />, { permissions: RESOLVER });

    // The notice still links to the differences.
    expect(screen.getByRole('link', { name: 'Review match' })).toHaveAttribute('href', '#bill-matching');

    await user.click(screen.getByRole('button', { name: 'Resolve exception' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });

  it('is withheld from a user who may not resolve match exceptions', () => {
    renderWithProviders(<BillDocumentHeader bill={BLOCKED} />, {
      permissions: [ACCOUNTING_PERMISSIONS.managePayables],
    });

    expect(screen.getByRole('link', { name: 'Review match' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve exception' })).not.toBeInTheDocument();
  });

  it('is withheld once the exception already carries a resolution', () => {
    mocks.useBillMatch.mockReturnValue({
      data: { ...EXCEPTION, resolutionAction: 'REQUIRE_PO_REVISION' },
      isPending: false,
      isError: false,
    });
    renderWithProviders(<BillDocumentHeader bill={BLOCKED} />, { permissions: RESOLVER });

    expect(screen.queryByRole('button', { name: 'Resolve exception' })).not.toBeInTheDocument();
  });

  it('does not appear on a disputed match — there is nothing to resolve from the header', () => {
    renderWithProviders(<BillDocumentHeader bill={{ ...BLOCKED, matchStatus: 'DISPUTED' }} />, {
      permissions: RESOLVER,
    });

    expect(screen.queryByRole('button', { name: 'Resolve exception' })).not.toBeInTheDocument();
  });
});

// ─── Return for correction / reject / edit (ADR-037 amendment) ─────────────────────

const SUBMITTED = {
  ...BLOCKED,
  billNumber: 'BILL-2026-0042',
  documentStatus: 'SUBMITTED',
  matchStatus: 'NOT_RUN',
  purchaseOrderId: null,
  purchaseOrderRevisionId: null,
} as unknown as SupplierBill;

const MANAGER = [ACCOUNTING_PERMISSIONS.managePayables];

async function openKebab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
}

describe('BillDocumentHeader — return and reject a submitted bill', () => {
  it('offers Return for correction and Reject in the kebab, with Approve still primary', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BillDocumentHeader bill={SUBMITTED} />, { permissions: MANAGER });

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    await openKebab(user);
    const items = await screen.findAllByRole('menuitem');
    // Reject is destructive, so it sits last.
    expect(items.map((item) => item.textContent)).toEqual(['Return for correction', 'Reject']);
  });

  it('offers neither without the manage-payables permission', () => {
    renderWithProviders(<BillDocumentHeader bill={SUBMITTED} />, { permissions: [] });
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  it.each(['DRAFT', 'APPROVED', 'REJECTED'] as const)('offers neither on a %s bill', async (documentStatus) => {
    const user = userEvent.setup();
    renderWithProviders(<BillDocumentHeader bill={{ ...SUBMITTED, documentStatus }} />, { permissions: MANAGER });

    const kebab = screen.queryByRole('button', { name: 'More actions' });
    if (kebab) {
      await openKebab(user);
      expect(screen.queryByRole('menuitem', { name: 'Return for correction' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Reject' })).not.toBeInTheDocument();
    }
  });

  it('keeps Reject off the menu of whoever entered the bill — they may still return it', async () => {
    const user = userEvent.setup();
    // renderWithProviders signs in as `test-user`.
    renderWithProviders(<BillDocumentHeader bill={{ ...SUBMITTED, createdBy: 'test-user' }} />, {
      permissions: MANAGER,
    });

    await openKebab(user);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Return for correction']);
  });

  it('returns the bill only once a reason is given', async () => {
    const user = userEvent.setup();
    const returnMutate = vi.fn();
    mocks.useReturnSupplierBill.mockReturnValue({ ...idle, mutate: returnMutate });
    renderWithProviders(<BillDocumentHeader bill={SUBMITTED} />, { permissions: MANAGER });

    await openKebab(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Return for correction' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Return BILL-2026-0042 for correction?');
    expect(dialog).toHaveTextContent(/goes back to draft so it can be corrected/);

    await user.click(screen.getByRole('button', { name: 'Return for correction' }));
    expect(returnMutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('What needs correcting')).toBeInTheDocument();

    await user.type(screen.getByLabelText('What needs correcting'), 'Amount is $5,060, not $5,660.');
    await user.click(screen.getByRole('button', { name: 'Return for correction' }));
    expect(returnMutate).toHaveBeenCalledWith(
      { id: 'bill-1', reason: 'Amount is $5,060, not $5,660.' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('rejects the bill only once a reason is given, from a destructive confirm', async () => {
    const user = userEvent.setup();
    const rejectMutate = vi.fn();
    mocks.useRejectSupplierBill.mockReturnValue({ ...idle, mutate: rejectMutate });
    renderWithProviders(<BillDocumentHeader bill={{ ...SUBMITTED, billNumber: null }} />, { permissions: MANAGER });

    await openKebab(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Reject' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Reject this bill?');
    expect(dialog).toHaveTextContent(/never posted/);
    expect(dialog).toHaveTextContent(/can't be undone/);

    await user.click(screen.getByRole('button', { name: 'Reject bill' }));
    expect(rejectMutate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Reason for rejecting'), 'Duplicate of BILL-2026-0040.');
    await user.click(screen.getByRole('button', { name: 'Reject bill' }));
    expect(rejectMutate).toHaveBeenCalledWith(
      { id: 'bill-1', reason: 'Duplicate of BILL-2026-0040.' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});

describe('BillDocumentHeader — returned and rejected notices', () => {
  it('says a returned draft was returned, why, and links to edit it', () => {
    renderWithProviders(
      <BillDocumentHeader
        bill={{
          ...SUBMITTED,
          documentStatus: 'DRAFT',
          returnedAt: '2026-09-20T10:00:00.000Z',
          returnReason: 'Amount is $5,060, not $5,660.',
        }}
      />,
      { permissions: MANAGER },
    );

    expect(screen.getByText(/^Returned for correction on/)).toBeInTheDocument();
    expect(screen.getByText('Amount is $5,060, not $5,660.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit bill' })).toHaveAttribute(
      'href',
      '/finance/accounting/bills/bill-1/edit',
    );
  });

  it('says a rejected bill was rejected, and why, with no commands left', () => {
    renderWithProviders(
      <BillDocumentHeader
        bill={{
          ...SUBMITTED,
          documentStatus: 'REJECTED',
          rejectedAt: '2026-09-20T10:00:00.000Z',
          rejectionReason: 'Duplicate of BILL-2026-0040.',
        }}
      />,
      { permissions: MANAGER },
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/Rejected on/);
    expect(screen.getByText('Duplicate of BILL-2026-0040.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('offers Edit bill in the kebab of a draft, with Submit still primary', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BillDocumentHeader bill={{ ...SUBMITTED, documentStatus: 'DRAFT' }} />, {
      permissions: MANAGER,
    });

    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    await openKebab(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Edit bill' }));
    expect(routerMocks.push).toHaveBeenCalledWith('/finance/accounting/bills/bill-1/edit');
  });
});

describe('BillDocumentHeader — a refused post', () => {
  /**
   * ADR-040 review: the server refuses a bill whose line names a non-expense profile
   * (400 POSTING_PROFILE_NOT_EXPENSE) and names the profile. The dialog says that, not a
   * generic failure.
   */
  it('shows the server’s reason in the post dialog', async () => {
    const { ApiError } = await import('@/lib/api-client');
    mocks.usePostSupplierBill.mockReturnValue({
      ...idle,
      isError: true,
      error: new ApiError(
        400,
        'Posting profile PROJECT_REVENUE is not an expense profile',
        'POSTING_PROFILE_NOT_EXPENSE',
      ),
    });
    const bill = {
      ...BLOCKED,
      purchaseOrderId: null,
      purchaseOrderRevisionId: null,
      matchStatus: 'NOT_REQUIRED',
    } as unknown as SupplierBill;
    const user = userEvent.setup();
    renderWithProviders(<BillDocumentHeader bill={bill} />, {
      permissions: [ACCOUNTING_PERMISSIONS.managePayables],
    });

    await user.click(screen.getByRole('button', { name: 'Post' }));

    expect(
      await screen.findByText('Posting profile PROJECT_REVENUE is not an expense profile'),
    ).toBeInTheDocument();
  });
});
