import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessageView, WhatsAppSendPreview } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import type { ReceiptDetail as ReceiptDetailModel } from '../types';

const mocks = vi.hoisted(() => ({
  useReceipt: vi.fn(),
  openDocument: vi.fn(),
  getPreview: vi.fn(),
  send: vi.fn(),
  useCommunications: vi.fn(),
  reverse: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../hooks/use-receipts', () => ({
  useReceipt: mocks.useReceipt,
  useOpenReceiptDocument: () => ({
    mutate: mocks.openDocument,
    isPending: false,
    isError: false,
  }),
  useReverseReceipt: () => ({ mutate: mocks.reverse, reset: vi.fn(), isPending: false, isError: false, error: null }),
  useCancelReceipt: () => ({ mutate: mocks.cancel, reset: vi.fn(), isPending: false, isError: false, error: null }),
  receiptKeys: { all: ['receipts'], detail: (id: string) => ['receipts', 'detail', id] },
}));
vi.mock('@/features/refunds/refunds', () => ({
  useRefunds: () => ({ data: [] }),
  useRequestRefund: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
  useDecideRefund: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('@/features/accounting/hooks/use-accounting', async (original) => ({
  ...(await original<object>()),
  useApprovalSettings: () => ({ data: { paymentAutoApproveUpTo: '1000.00' } }),
  useBankAccounts: () => ({ data: [] }),
}));
vi.mock('./receipt-allocations-panel', () => ({
  ReceiptAllocationsPanel: () => null,
  ApplyOnAccountDialog: () => <div role="dialog">Apply money on account</div>,
}));
vi.mock('./post-receipt-dialog', () => ({ PostReceiptDialog: () => <div role="dialog">Post receipt</div> }));
vi.mock('@/features/clients/hooks/use-client', () => ({
  useClient: () => ({ data: { name: 'Hodan Construction Ltd' } }),
}));
vi.mock('@/features/communications/api', () => ({
  getReceiptWhatsAppPreview: mocks.getPreview,
  sendReceiptWhatsApp: mocks.send,
}));
vi.mock('@/features/communications/hooks', () => ({
  useCommunications: mocks.useCommunications,
  useResolveCommunication: () => ({ isPending: false, mutate: vi.fn() }),
  communicationKeys: { all: ['communications'], resource: () => ['communications'] },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
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

import { ReceiptDetail } from './receipt-detail';

function receipt(overrides: Partial<ReceiptDetailModel> = {}): ReceiptDetailModel {
  return {
    id: 'rcp-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    bankAccountId: null,
    receiptDate: '2026-10-01',
    accountingDate: '2026-10-01',
    totalAmount: '5000.00',
    allocatedAmount: '5000.00',
    unallocatedAmount: '0.00',
    currencyCode: 'USD',
    reference: 'BANK-77',
    receiptNumber: 'RCP-000017',
    paymentMethod: 'BANK_TRANSFER',
    bankAccount: { bankName: 'Premier Bank', accountName: 'Operating' },
    refundedAmount: '0.00',
    notes: null,
    documentStatus: 'ACTIVE',
    postingStatus: 'POSTED',
    createdBy: 'user-1',
    createdAt: '2026-10-01T09:00:00.000Z',
    allocations: [],
    ...overrides,
  };
}

const preview = (over: Partial<WhatsAppSendPreview> = {}): WhatsAppSendPreview => ({
  templateConfigured: true,
  whatsappConfigured: true,
  recipients: [
    {
      contactId: 'k1',
      name: 'Hodan',
      role: null,
      number: '+252615555555',
      isPrimary: true,
      source: 'whatsapp',
    },
  ],
  defaultRecipient: '+252615555555',
  message: 'Hello Hodan Construction Ltd, please find attached receipt RCP-000017.',
  filename: 'RCP-000017.pdf',
  sendable: true,
  blockedReason: null,
  ...over,
});

const sent: OutboundMessageView = {
  id: 'm1',
  channel: 'WHATSAPP',
  purpose: 'RECEIPT',
  clientId: 'client-1',
  recipient: '+252615555555',
  resourceType: 'payment_receipt',
  resourceId: 'rcp-1',
  templateName: 'rukna_receipt',
  templateLanguage: 'en',
  status: 'SENT',
  queuedAt: '2026-10-02T10:00:00.000Z',
  sentAt: '2026-10-02T10:00:01.000Z',
  deliveredAt: null,
  readAt: null,
  failedAt: null,
  errorCode: null,
  errorMessage: null,
  createdBy: 'u1',
  createdAt: '2026-10-02T10:00:00.000Z',
} as OutboundMessageView;

function show(data: ReceiptDetailModel, permissions: string[] = ['manage:receivable']) {
  mocks.useReceipt.mockReturnValue({ data, isPending: false, isError: false, error: null });
  return renderWithProviders(<ReceiptDetail receiptId={data.id} />, { permissions, withToast: true });
}

/** The actions behind More, by name. */
async function moreItems(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(screen.getByRole('button', { name: 'More' }));
  return (await screen.findAllByRole('menuitem')).map((item) => item.textContent ?? '');
}

async function chooseMore(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCommunications.mockReturnValue({ isPending: false, isError: false, data: [] });
  mocks.getPreview.mockResolvedValue(preview());
  mocks.send.mockResolvedValue(sent);
});

describe('ReceiptDetail — the receipt', () => {
  it('names the number, client, bank, method and reference, and balances to on account', () => {
    show(receipt({ unallocatedAmount: '250.00', allocatedAmount: '4650.00', refundedAmount: '100.00' }));
    expect(screen.getByRole('heading', { name: /RCP-000017/ })).toBeInTheDocument();
    expect(screen.getAllByText('Hodan Construction Ltd').length).toBeGreaterThan(0);
    expect(screen.getByText('Premier Bank · Operating')).toBeInTheDocument();
    expect(screen.getAllByText('Bank transfer').length).toBeGreaterThan(0);
    expect(screen.getByText('BANK-77')).toBeInTheDocument();
    // 5,000 received − 4,650 applied − 100 refunded = 250 on account.
    expect(screen.getByText('Applied to invoices').nextSibling).toHaveTextContent('−$4,650.00');
    expect(screen.getByText('Refunded').nextSibling).toHaveTextContent('−$100.00');
    expect(screen.getByText('On account', { selector: 'dt' }).nextSibling).toHaveTextContent('$250.00');
  });
});

describe('ReceiptDetail — receipt PDF and WhatsApp', () => {
  it('a posted receipt offers the PDF and, under More, Send on WhatsApp', async () => {
    const user = userEvent.setup();
    show(receipt());
    await user.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mocks.openDocument).toHaveBeenCalledWith('rcp-1');
    expect(await moreItems(user)).toEqual(['Send on WhatsApp', 'Reverse receipt']);
  });

  it('a not-posted receipt offers Post and Cancel, but no PDF or WhatsApp', async () => {
    const user = userEvent.setup();
    show(receipt({ postingStatus: 'NOT_POSTED', receiptNumber: null }));
    expect(screen.getByRole('heading', { name: /Not posted/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Post receipt');
  });

  it('a reversed receipt offers neither and says when and why', () => {
    show(receipt({ postingStatus: 'REVERSED', reversedAt: '2026-10-20T08:00:00.000Z', reversalReason: 'Cheque bounced' }));
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(screen.getByText('Reversed on Oct 20, 2026: Cheque bounced')).toBeInTheDocument();
  });

  it('without manage:receivable, offers no actions (the document endpoint needs it too)', () => {
    show(receipt(), ['view:receivable']);
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('a posted receipt with no number (opening balance) offers no PDF or WhatsApp — the API refuses it', async () => {
    const user = userEvent.setup();
    show(receipt({ receiptNumber: null }));
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    expect(await moreItems(user)).toEqual(['Reverse receipt']);
  });

  it('opens the send dialog and sends the receipt with an idempotency key', async () => {
    const user = userEvent.setup();
    show(receipt());
    await chooseMore(user, 'Send on WhatsApp');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Send receipt on WhatsApp');
    expect(dialog).toHaveTextContent('Receipt RCP-000017 goes to the client as a PDF.');
    expect(await screen.findByText('RCP-000017.pdf')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Send on WhatsApp' }).at(-1)!);
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('rcp-1', {
        recipient: '+252615555555',
        idempotencyKey: expect.any(String),
      }),
    );
    expect(mocks.getPreview).toHaveBeenCalledWith('rcp-1');
  });

  it('shows the receipt-specific blocked reason from the preview', async () => {
    const user = userEvent.setup();
    mocks.getPreview.mockResolvedValue(preview({ sendable: false, blockedReason: 'REVERSED' }));
    show(receipt());
    await chooseMore(user, 'Send on WhatsApp');
    expect(await screen.findByText(/A reversed receipt must not be sent to the client/)).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('lists the receipt’s messages for payment_receipt', () => {
    show(receipt());
    expect(mocks.useCommunications).toHaveBeenCalledWith('payment_receipt', 'rcp-1');
  });
});

describe('ReceiptDetail — money on account', () => {
  it('offers Apply to invoices and a refund only while the receipt holds money on account', async () => {
    const user = userEvent.setup();
    const { unmount } = show(receipt({ unallocatedAmount: '250.00', allocatedAmount: '4750.00' }));
    await user.click(screen.getByRole('button', { name: 'Apply to invoices' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Apply money on account');
    unmount();

    show(receipt({ unallocatedAmount: '250.00', allocatedAmount: '4750.00' }));
    expect(await moreItems(user)).toContain('Refund money on account');
  });

  it('a fully applied receipt offers neither', async () => {
    const user = userEvent.setup();
    show(receipt());
    expect(screen.queryByRole('button', { name: 'Apply to invoices' })).not.toBeInTheDocument();
    expect(await moreItems(user)).not.toContain('Refund money on account');
  });
});

describe('ReceiptDetail — reversing and cancelling', () => {
  it('reverses a posted receipt only with a reason', async () => {
    const user = userEvent.setup();
    show(receipt());
    await chooseMore(user, 'Reverse receipt');
    expect(screen.getByText('Reverse receipt RCP-000017?')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Reverse receipt' }).at(-1)!);
    expect(mocks.reverse).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Why is it reversed/), 'Cheque bounced');
    await user.click(screen.getAllByRole('button', { name: 'Reverse receipt' }).at(-1)!);
    expect(mocks.reverse).toHaveBeenCalledWith('Cheque bounced', expect.anything());
  });

  it('cancels an unposted receipt with a reason', async () => {
    const user = userEvent.setup();
    show(receipt({ postingStatus: 'NOT_POSTED', receiptNumber: null }));
    await chooseMore(user, 'Cancel receipt');
    await user.type(screen.getByLabelText(/Why is it cancelled/), 'Recorded twice');
    await user.click(screen.getAllByRole('button', { name: 'Cancel receipt' }).at(-1)!);
    expect(mocks.cancel).toHaveBeenCalledWith('Recorded twice', expect.anything());
  });

  it('a cancelled receipt says why and offers nothing', () => {
    show(
      receipt({
        postingStatus: 'NOT_POSTED',
        receiptNumber: null,
        documentStatus: 'CANCELLED',
        cancelledAt: '2026-10-21T08:00:00.000Z',
        cancellationReason: 'Recorded twice',
      }),
    );
    expect(screen.getByRole('heading', { name: /Cancelled receipt/ })).toBeInTheDocument();
    expect(screen.getByText('Cancelled: Recorded twice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });
});
