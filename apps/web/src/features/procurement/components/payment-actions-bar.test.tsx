import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { SupplierPayment } from '../types';

/**
 * SP-4 — the payment header shows the one next step and nothing dead: Approve on a draft, Sign
 * release on an approved payment under dual control, Post otherwise; the remittance PDF once
 * posted; reverse, reject/cancel and "supplier paid back" under More.
 */

const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null };
const mocks = vi.hoisted(() => ({
  useApproveSupplierPayment: vi.fn(),
  useEndSupplierPayment: vi.fn(),
  useOpenSupplierPaymentDocument: vi.fn(),
  usePostSupplierPayment: vi.fn(),
  useReleaseSupplierPayment: vi.fn(),
  useReverseSupplierPayment: vi.fn(),
}));
const accounting = vi.hoisted(() => ({
  useAccounts: vi.fn(() => ({ data: [] })),
  useBankAccounts: vi.fn(() => ({ data: [] })),
  useSignatories: vi.fn(() => ({ data: [] })),
}));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('@/features/accounting/hooks/use-accounting', () => accounting);
vi.mock('@/features/workflows/components/gated-action-button', () => ({
  GatedActionButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock('@/features/supplier-refunds/supplier-refund-dialog', () => ({ SupplierRefundDialog: () => null }));

import { PaymentHeaderActions } from './payment-actions-bar';

const PAYMENT = {
  id: 'p1',
  paymentNumber: null,
  supplierId: 's1',
  bankAccountId: 'bank-1',
  paymentDate: '2026-10-30',
  accountingDate: '2026-10-30',
  currencyCode: 'USD',
  totalAmount: '100.00',
  allocatedAmount: '100.00',
  unallocatedAmount: '0.00',
  paymentMethod: 'CHEQUE',
  bankReference: '004512',
  notes: null,
  documentStatus: 'DRAFT',
  postingStatus: 'NOT_POSTED',
  postedJournalEntryId: null,
  createdBy: 'someone-else',
} as unknown as SupplierPayment;

const MANAGE = { permissions: ['manage:payable'] };

beforeEach(() => {
  for (const hook of Object.values(mocks)) hook.mockReturnValue(idle);
  accounting.useSignatories.mockReturnValue({ data: [] });
});

describe('PaymentHeaderActions (SP-4)', () => {
  it('a draft offers Approve, with reject under More and no dead Post or Reverse', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaymentHeaderActions payment={PAYMENT} />, MANAGE);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Reject payment' })).toBeInTheDocument();
  });

  it('an approved payment on a dual-control account asks for a signature, else offers Post', () => {
    const approved = { ...PAYMENT, documentStatus: 'APPROVED' } as SupplierPayment;
    accounting.useSignatories.mockReturnValue({ data: [{ id: 'sig-1' }] } as never);
    const { unmount } = renderWithProviders(<PaymentHeaderActions payment={approved} />, MANAGE);
    expect(screen.getByRole('button', { name: 'Sign release' })).toBeInTheDocument();
    unmount();
    accounting.useSignatories.mockReturnValue({ data: [] });
    renderWithProviders(<PaymentHeaderActions payment={approved} />, MANAGE);
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
  });

  it('a posted payment offers the remittance advice, and Reverse and Supplier paid back under More', async () => {
    const user = userEvent.setup();
    const posted = { ...PAYMENT, documentStatus: 'APPROVED', postingStatus: 'POSTED', paymentNumber: 'PMT-000009', unallocatedAmount: '40.00' } as SupplierPayment;
    renderWithProviders(<PaymentHeaderActions payment={posted} />, MANAGE);
    expect(screen.getByRole('button', { name: 'Remittance advice' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Reverse' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /paid back/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Reject payment' })).not.toBeInTheDocument();
  });

  it('offers nothing without manage-payables', () => {
    const { container } = renderWithProviders(<PaymentHeaderActions payment={PAYMENT} />);
    expect(container.querySelector('button')).toBeNull();
  });
});
