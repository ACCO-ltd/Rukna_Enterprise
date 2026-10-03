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
}));

vi.mock('../hooks/use-receipts', () => ({
  useReceipt: mocks.useReceipt,
  useOpenReceiptDocument: () => ({
    mutate: mocks.openDocument,
    isPending: false,
    isError: false,
  }),
  receiptKeys: { all: ['receipts'], detail: (id: string) => ['receipts', 'detail', id] },
}));
vi.mock('./receipt-allocations-panel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./receipt-allocations-panel')>()),
  ReceiptAllocationsPanel: () => null,
}));
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
  renderWithProviders(<ReceiptDetail receiptId={data.id} />, { permissions, withToast: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCommunications.mockReturnValue({ isPending: false, isError: false, data: [] });
  mocks.getPreview.mockResolvedValue(preview());
  mocks.send.mockResolvedValue(sent);
});

describe('ReceiptDetail — receipt PDF and WhatsApp', () => {
  it('a posted receipt offers Download receipt and Send on WhatsApp', async () => {
    const user = userEvent.setup();
    show(receipt());
    await user.click(screen.getByRole('button', { name: 'Download receipt' }));
    expect(mocks.openDocument).toHaveBeenCalledWith('rcp-1');
    expect(screen.getByRole('button', { name: 'Send on WhatsApp' })).toBeInTheDocument();
  });

  it('a not-posted receipt offers neither', () => {
    show(receipt({ postingStatus: 'NOT_POSTED', receiptNumber: null }));
    expect(screen.queryByRole('button', { name: 'Download receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
  });

  it('a reversed receipt offers neither and says why', () => {
    show(receipt({ postingStatus: 'REVERSED' }));
    expect(screen.queryByRole('button', { name: 'Download receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
    expect(screen.getByText(/This receipt was reversed/)).toBeInTheDocument();
  });

  it('without manage:receivable, offers neither (the document endpoint needs it too)', () => {
    show(receipt(), ['view:receivable']);
    expect(screen.queryByRole('button', { name: 'Download receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
  });

  it('a posted receipt with no number (opening balance) offers neither — the API refuses it', () => {
    show(receipt({ receiptNumber: null }));
    expect(screen.queryByRole('button', { name: 'Download receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
  });

  it('opens the send dialog and sends the receipt with an idempotency key', async () => {
    const user = userEvent.setup();
    show(receipt());
    await user.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Send receipt on WhatsApp');
    expect(dialog).toHaveTextContent('Receipt RCP-000017 goes to the client as a PDF.');
    expect(await screen.findByText('RCP-000017.pdf')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: 'Send on WhatsApp' });
    await user.click(buttons[buttons.length - 1]);
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
    await user.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));
    expect(
      await screen.findByText(/A reversed receipt must not be sent to the client/),
    ).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('lists the receipt’s messages for payment_receipt', () => {
    show(receipt());
    expect(mocks.useCommunications).toHaveBeenCalledWith('payment_receipt', 'rcp-1');
  });
});
