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
  useBillMatch: vi.fn(),
  useResolveMatchException: vi.fn(),
  useRunBillMatch: vi.fn(),
  useApproveMatchException: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);
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
  for (const hook of ['useApproveSupplierBill', 'usePostSupplierBill', 'useReverseSupplierBill', 'useSubmitSupplierBill', 'useResolveMatchException', 'useRunBillMatch', 'useApproveMatchException'] as const) {
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
