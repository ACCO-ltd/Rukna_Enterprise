import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { paymentFixture, releaseDraftFixture } from '../../quotations/payment-fixtures';
import type { QuotationPayment, StoreDocumentSummary } from '../../quotations/payment-types';
import { detailFixture, quoteFixture } from '../../quotations/test-fixtures';
import type { QuotationRequestDetail } from '../../quotations/types';

/**
 * Record receipt (ADR-045 P13, wireframe E): the photo big, one Total, one confirm; the result
 * per step (DONE / MATCH_EXCEPTION with Resume); Change returned capped at what the buyer holds;
 * Top up applied to the recorded bill (S7).
 */

const api = vi.hoisted(() => ({
  detail: null as unknown,
  record: vi.fn(),
  ret: vi.fn(),
  releaseDraft: vi.fn(),
  release: vi.fn(),
}));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuotationRequest: async () => api.detail,
}));
vi.mock('../../api/quotation-payment-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordStoreDocument: (...args: unknown[]) => api.record(...args),
  recordAdvanceReturn: (...args: unknown[]) => api.ret(...args),
  getReleaseDraft: (...args: unknown[]) => api.releaseDraft(...args),
  releaseCash: (...args: unknown[]) => api.release(...args),
}));
vi.mock('@/features/files/api/files-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFileDownloadUrl: async (id: string) => ({ url: `https://files.test/${id}`, originalName: id, mimeType: 'image/jpeg' }),
}));
const ACCOUNT = {
  id: 'a-mat',
  code: '50100',
  status: 'ACTIVE',
  versions: [
    {
      id: 'v1',
      versionNumber: 1,
      name: 'Materials',
      accountClass: 'EXPENSE',
      accountSubtype: 'DIRECT_COST',
      normalBalance: 'DEBIT',
      isPostingAllowed: true,
      isControlAccount: false,
      controlledSubledgerType: null,
      controlPostingPolicy: 'UNRESTRICTED',
      parentAccountId: null,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
};
const PROFILE = {
  id: 'p1',
  code: 'MATERIAL_PURCHASE',
  status: 'ACTIVE',
  versions: [
    { id: 'pv1', versionNumber: 1, name: 'Material purchase', description: null, accountId: 'a-mat', effectiveFrom: '2026-01-01', effectiveTo: null },
  ],
};
const BANK = {
  id: 'ba-cash',
  glAccountId: 'g1',
  bankName: 'Cash box',
  accountName: 'Cash box',
  accountNumber: 'CASH-BOX',
  iban: null,
  swiftCode: null,
  currencyCode: 'USD',
  branch: null,
  allowsReceipts: true,
  allowsPayments: true,
  isReconcilable: false,
  status: 'ACTIVE',
};
vi.mock('@/features/accounting/hooks/use-accounting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAccounts: () => ({ data: [ACCOUNT], isPending: false, isError: false }),
  usePostingProfiles: () => ({ data: [PROFILE], isPending: false, isError: false }),
  useBankAccounts: () => ({ data: [BANK], isPending: false, isError: false }),
}));

import { RecordReceiptScreen } from './record-receipt-screen';

const PAYER = ['view:procurement', 'manage:payable', 'view:commitment-ledger'];

const submitted: StoreDocumentSummary = {
  id: 'sd-1',
  number: 'SD-00019',
  kind: 'RECEIPT',
  status: 'SUBMITTED',
  uploadedByName: 'Ahmed Ali',
  createdAt: '2026-10-08T07:42:00Z',
  photos: [{ fileId: 'f-1', pageNumber: 1 }, { fileId: 'f-2', pageNumber: 2 }],
};

const advance = (outstanding: string) => ({
  id: 'adv1',
  recipientUserId: 'u-ahmed',
  recipientName: 'Ahmed Ali',
  amount: '1000.00',
  advancedAt: '2026-10-08',
  applied: '0.00',
  returned: '0.00',
  outstanding,
  legacy: false,
});

function awarded(payment: Partial<QuotationPayment>): QuotationRequestDetail {
  return detailFixture({
    status: 'AWARDED',
    quotes: [quoteFixture({ id: 'k1', name: 'Bakaara Steel' })],
    award: { quoteId: 'k1', total: '1000.00', supplier: { id: 's9', name: 'Bakaara Steel' }, paymentPath: 'BUYER_CASH' },
    purchaseOrder: { id: 'po1', poNumber: 'PO-00311', status: 'OPEN' },
    payment: paymentFixture({
      state: 'RECEIPT_TO_RECORD',
      funded: '1000.00',
      withBuyer: '1000.00',
      remainingToFund: '0.00',
      receivingStatus: 'RECEIVED',
      advances: [advance('1000.00')],
      storeDocuments: [submitted],
      allowedActions: [{ action: 'RECORD_RECEIPT', enabled: true }],
      ...payment,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.detail = awarded({});
  api.releaseDraft.mockResolvedValue(releaseDraftFixture({ remainingToFund: '30.00' }));
});

describe('RecordReceiptScreen', () => {
  it('shows the receipt photo big with its pages and records with one Total', async () => {
    const user = userEvent.setup();
    api.record.mockImplementation(async () => {
      api.detail = awarded({
        state: 'SETTLING',
        withBuyer: '20.00',
        advances: [{ ...advance('20.00'), applied: '980.00' }],
        storeDocuments: [{ ...submitted, status: 'RECORDED', supplierBillId: 'b-91', billNumber: 'BILL-0091' }],
        allowedActions: [
          { action: 'RECORD_RETURN', enabled: true },
          { action: 'TOP_UP', enabled: false, reason: 'NOTHING_TO_FUND' },
        ],
      });
      return {
        storeDocument: { ...submitted, status: 'RECORDED' },
        bill: { id: 'b-91', billNumber: 'BILL-0091' },
        step: 'DONE',
        applied: [{ kind: 'BUYER_ADVANCE', id: 'adv1', amount: '980.00' }],
      };
    });
    renderWithProviders(<RecordReceiptScreen requestId="qr1" documentId="sd-1" />, { permissions: PAYER });

    expect(await screen.findByRole('img', { name: 'Receipt, page 1' })).toHaveAttribute('src', 'https://files.test/f-1');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText("Paid from Ahmed's cash")).toBeInTheDocument();

    await user.type(screen.getByLabelText('Total on receipt'), '980');
    await user.click(screen.getByRole('button', { name: 'Record and settle' }));

    await waitFor(() => expect(api.record).toHaveBeenCalledTimes(1));
    expect(api.record.mock.calls[0]![0]).toEqual({
      storeDocumentId: 'sd-1',
      total: '980.00',
      documentDate: '2026-10-08',
      expenseProfileCode: 'MATERIAL_PURCHASE',
    });
    expect(await screen.findByText(/Settled \$980\.00 from Ahmed's cash · \$20\.00 still with Ahmed/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Change returned' })).toBeInTheDocument();
    expect(localStorage.getItem('quote-receipt-expense-profile')).toBe('MATERIAL_PURCHASE');
  });

  it('a receipt above the order stops at the price exception, links the bill and resumes with the id only', async () => {
    const user = userEvent.setup();
    api.record.mockResolvedValueOnce({
      storeDocument: submitted,
      bill: { id: 'b-91', billNumber: 'BILL-0091' },
      step: 'MATCH_EXCEPTION',
      exceptionKind: 'ABOVE_ORDER',
      applied: [],
    });
    renderWithProviders(<RecordReceiptScreen requestId="qr1" documentId="sd-1" />, { permissions: PAYER });
    await user.type(await screen.findByLabelText('Total on receipt'), '1030');
    await user.click(screen.getByRole('button', { name: 'Record and settle' }));

    expect(await screen.findByText('Receipt is above the order')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open BILL-0091' })).toHaveAttribute('href', '/finance/accounting/bills/b-91');

    api.record.mockResolvedValueOnce({ storeDocument: submitted, bill: { id: 'b-91' }, step: 'DONE', applied: [{ kind: 'BUYER_ADVANCE', id: 'adv1', amount: '1000.00' }] });
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.record).toHaveBeenCalledTimes(2));
    expect(api.record.mock.calls[1]![0]).toEqual({ storeDocumentId: 'sd-1' });
  });

  it('another match exception is worded as such, and a bill with no number is linked by id (never the SD number)', async () => {
    const user = userEvent.setup();
    api.record.mockResolvedValueOnce({
      storeDocument: submitted,
      bill: { id: 'b-92', billNumber: null, supplierInvoiceNumber: 'SD-00019' },
      step: 'MATCH_EXCEPTION',
      exceptionKind: 'QUANTITY',
      applied: [],
    });
    renderWithProviders(<RecordReceiptScreen requestId="qr1" documentId="sd-1" />, { permissions: PAYER });
    await user.type(await screen.findByLabelText('Total on receipt'), '900');
    await user.click(screen.getByRole('button', { name: 'Record and settle' }));
    expect(await screen.findByText("The bill doesn't match the order")).toBeInTheDocument();
    expect(screen.queryByText('Receipt is above the order')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the bill' })).toHaveAttribute('href', '/finance/accounting/bills/b-92');
    expect(screen.queryByText(/SD-00019/, { selector: 'a' })).not.toBeInTheDocument();
  });

  it('waits for the goods, in words, before recording', async () => {
    api.detail = awarded({
      receivingStatus: 'NOT_RECEIVED',
      allowedActions: [{ action: 'RECORD_RECEIPT', enabled: false, reason: 'GOODS_NOT_RECEIVED' }],
    });
    renderWithProviders(<RecordReceiptScreen requestId="qr1" documentId="sd-1" />, { permissions: PAYER });
    expect(await screen.findByRole('button', { name: 'Record and settle' })).toBeDisabled();
    expect(screen.getByText('Waiting for the site to receive the goods.')).toBeInTheDocument();
  });

  it('Change returned is prefilled with what the buyer holds and capped there', async () => {
    const user = userEvent.setup();
    api.detail = awarded({
      state: 'SETTLING',
      withBuyer: '20.00',
      advances: [{ ...advance('20.00'), applied: '980.00' }],
      storeDocuments: [{ ...submitted, status: 'RECORDED', supplierBillId: 'b-91' }],
      allowedActions: [{ action: 'RECORD_RETURN', enabled: true }],
    });
    renderWithProviders(<RecordReceiptScreen requestId="qr1" documentId="sd-1" />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Change returned' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change returned' });
    const amount = within(dialog).getByLabelText('Amount returned');
    expect(amount).toHaveValue('20.00');
    expect(within(dialog).getByText('At most $20.00 — what Ahmed Ali still holds.')).toBeInTheDocument();

    await user.clear(amount);
    await user.type(amount, '25');
    await user.click(within(dialog).getByRole('button', { name: 'Record $25.00 returned' }));
    expect(await within(dialog).findByText('That is more than the $20.00 still held.')).toBeInTheDocument();
    expect(api.ret).not.toHaveBeenCalled();

    api.ret.mockResolvedValueOnce({});
    await user.clear(amount);
    await user.type(amount, '20');
    await user.click(within(dialog).getByRole('button', { name: 'Record $20.00 returned' }));
    await waitFor(() => expect(api.ret).toHaveBeenCalledTimes(1));
    expect(api.ret.mock.calls[0]).toEqual([
      'adv1',
      {
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        amount: '20.00',
        returnMethod: 'CASH',
        destinationBankAccountId: 'ba-cash',
        receivedAt: expect.any(String),
      },
    ]);
  });

  it('Top up releases the difference and applies it to the recorded bill (S7)', async () => {
    const user = userEvent.setup();
    api.detail = awarded({
      state: 'SETTLING',
      withBuyer: '0.00',
      advances: [{ ...advance('0.00'), applied: '1000.00' }],
      storeDocuments: [{ ...submitted, status: 'RECORDED', supplierBillId: 'b-91' }],
      allowedActions: [{ action: 'TOP_UP', enabled: true }],
    });
    api.release.mockResolvedValueOnce({ advance: { id: 'adv2' }, payment: null });
    renderWithProviders(<RecordReceiptScreen requestId="qr1" documentId="sd-1" />, { permissions: PAYER });
    await user.click(await screen.findByRole('button', { name: 'Top up' }));
    const dialog = await screen.findByRole('dialog', { name: 'Top up cash' });
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('30.00');
    expect(
      within(dialog).getByText(
        'At most $30.00 — the receipt is above the cash released; this is the difference, never more than the order.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Release $30.00' }));
    await waitFor(() => expect(api.release).toHaveBeenCalledTimes(1));
    expect(api.release.mock.calls[0]![0]).toMatchObject({ amount: '30.00', applyToBillId: 'b-91' });
  });
});
