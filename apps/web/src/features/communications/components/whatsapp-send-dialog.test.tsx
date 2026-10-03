import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OutboundMessageView, WhatsAppSendPreview } from '@erp/types';

import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import { WhatsAppSendDialog, type WhatsAppSendItem } from './whatsapp-send-dialog';

const preview = (over: Partial<WhatsAppSendPreview> = {}): WhatsAppSendPreview => ({
  templateConfigured: true,
  whatsappConfigured: true,
  recipients: [
    {
      contactId: 'k2',
      name: 'Hodan',
      role: 'Director',
      number: '+252615555555',
      isPrimary: true,
      source: 'whatsapp',
    },
    {
      contactId: 'k1',
      name: 'Ali',
      role: null,
      number: '+252612345678',
      isPrimary: false,
      source: 'phone',
    },
  ],
  defaultRecipient: '+252615555555',
  message:
    'Hello Hodan Construction Ltd, please find attached invoice INV-000042 from ACCO Ltd for USD 12,500.00, due on 15 Oct 2026.',
  filename: 'INV-000042.pdf',
  sendable: true,
  blockedReason: null,
  ...over,
});

const message = (over: Partial<OutboundMessageView> = {}): OutboundMessageView => ({
  id: 'm1',
  channel: 'WHATSAPP',
  purpose: 'INVOICE',
  clientId: 'cl1',
  recipient: '+252615555555',
  resourceType: 'client_invoice',
  resourceId: 'inv1',
  templateName: 'rukna_invoice',
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
  ...over,
});

function renderDialog(
  opts: {
    preview?: WhatsAppSendPreview;
    send?: ReturnType<typeof vi.fn>;
    extraItems?: WhatsAppSendItem[];
  } = {},
) {
  const loadPreview = vi.fn().mockResolvedValue(opts.preview ?? preview());
  const send = opts.send ?? vi.fn().mockResolvedValue(message());
  const onClose = vi.fn();
  const onSent = vi.fn();
  renderWithProviders(
    <WhatsAppSendDialog
      open
      onClose={onClose}
      title="Send invoice on WhatsApp"
      previewQueryKey={['wa-preview', Math.random()]}
      loadPreview={loadPreview}
      send={send}
      onSent={onSent}
      extraItems={opts.extraItems}
    />,
    { withToast: true },
  );
  return { loadPreview, send, onClose, onSent };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WhatsAppSendDialog', () => {
  it('shows the default recipient, the message preview and the attachment', async () => {
    renderDialog();
    expect(await screen.findByText(/please find attached invoice INV-000042/)).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toHaveTextContent(/Hodan \(Director\)/);
    expect(screen.getByText('INV-000042.pdf')).toBeInTheDocument();
  });

  it('sends to the default recipient with an idempotency key, toasts and closes', async () => {
    const user = userEvent.setup();
    const { send, onClose, onSent } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith({
      recipient: '+252615555555',
      idempotencyKey: expect.any(String),
    });
    expect(send.mock.calls[0][0].idempotencyKey.length).toBeGreaterThan(8);
    expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    expect(await screen.findByText(/Sent on WhatsApp to/)).toBeInTheDocument();
  });

  it('a double click sends once', async () => {
    const user = userEvent.setup();
    let release: (m: OutboundMessageView) => void = () => undefined;
    const send = vi
      .fn()
      .mockImplementation(() => new Promise<OutboundMessageView>((r) => (release = r)));
    renderDialog({ send });
    const button = await screen.findByRole('button', { name: 'Send on WhatsApp' });
    await user.dblClick(button);
    await user.click(button);
    release(message());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it('validates another number and sends it as E.164', async () => {
    const user = userEvent.setup();
    const { send } = renderDialog();
    await screen.findByText(/please find attached/);
    await chooseOption(user, screen.getByLabelText('To'), '__other__');

    const sendButton = screen.getByRole('button', { name: 'Send on WhatsApp' });
    expect(sendButton).toBeDisabled();
    const box = screen.getByRole('textbox', { name: 'WhatsApp number' });
    await user.type(box, '12');
    await user.tab();
    expect(
      screen.getByText('Enter a valid phone number, including the country code.'),
    ).toBeInTheDocument();
    expect(sendButton).toBeDisabled();

    await user.clear(box);
    await user.type(box, '61 333 3333');
    expect(
      screen.queryByText('Enter a valid phone number, including the country code.'),
    ).not.toBeInTheDocument();
    await user.click(sendButton);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        recipient: '+252613333333',
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('a text-only message (a reminder) lists no attachment', async () => {
    renderDialog({ preview: preview({ filename: null }) });
    expect(await screen.findByText(/please find attached invoice INV-000042/)).toBeInTheDocument();
    expect(screen.queryByText('Attachment')).not.toBeInTheDocument();
    expect(screen.getByText(/sends this approved message as it is/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send on WhatsApp' })).toBeEnabled();
  });

  it('an opening-balance invoice with no reference is blocked in words, not as "not issued"', async () => {
    renderDialog({
      preview: preview({ filename: null, sendable: false, blockedReason: 'NO_INVOICE_REFERENCE' }),
    });
    expect(await screen.findByText(/no invoice number or reference/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
  });

  it('a paid invoice blocks the reminder in words, with no Send button', async () => {
    renderDialog({
      preview: preview({ filename: null, sendable: false, blockedReason: 'NOTHING_OUTSTANDING' }),
    });
    expect(
      await screen.findByText(/fully paid, so there is nothing to remind/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
  });

  it('explains a hard block in words with no Send button', async () => {
    renderDialog({
      preview: preview({ sendable: false, blockedReason: 'TEMPLATE_NOT_CONFIGURED' }),
    });
    expect(await screen.findByText('This cannot be sent on WhatsApp yet')).toBeInTheDocument();
    expect(screen.getByText(/message template for this is not set up/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });

  it('a missing template still blocks when the server reported NO_RECIPIENT first', async () => {
    renderDialog({
      preview: preview({
        recipients: [],
        defaultRecipient: null,
        templateConfigured: false,
        sendable: false,
        blockedReason: 'NO_RECIPIENT',
      }),
    });
    expect(await screen.findByText('This cannot be sent on WhatsApp yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
  });

  it('with no saved number asks for one and offers the number box', async () => {
    renderDialog({
      preview: preview({
        recipients: [],
        defaultRecipient: null,
        sendable: false,
        blockedReason: 'NO_RECIPIENT',
      }),
    });
    expect(await screen.findByText(/no saved WhatsApp or phone number/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'WhatsApp number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send on WhatsApp' })).toBeDisabled();
  });

  it('shows a refusal from WhatsApp and retries with the same key', async () => {
    const user = userEvent.setup();
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        message({
          status: 'FAILED',
          sentAt: null,
          errorCode: 'RATE_LIMITED',
          errorMessage: 'WhatsApp is limiting how many messages we can send right now.',
        }),
      )
      .mockResolvedValueOnce(message());
    const { onClose } = renderDialog({ send });
    await user.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));
    expect(
      await screen.findByText('WhatsApp is limiting how many messages we can send right now.'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(send.mock.calls[1][0].idempotencyKey).toBe(send.mock.calls[0][0].idempotencyKey);
  });

  it('an unconfirmed send says so and offers no second send', async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue(message({ status: 'UNKNOWN', sentAt: null }));
    const { onClose } = renderDialog({ send });
    await user.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));
    expect(await screen.findByText('WhatsApp did not confirm the message')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Send on WhatsApp|Try again/ }),
    ).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('a package: one message per invoice', () => {
    it('sends each invoice in turn with its own derived key, then toasts and closes', async () => {
      const user = userEvent.setup();
      const order: string[] = [];
      const send = vi.fn().mockImplementation(async () => {
        order.push('main');
        return message();
      });
      const vo = vi.fn().mockImplementation(async () => {
        order.push('vo');
        return message({ id: 'm2', resourceId: 'inv2' });
      });
      const { onClose, onSent } = renderDialog({
        send,
        extraItems: [{ key: 'inv2', label: 'INV-000043.pdf', send: vo }],
      });
      expect(await screen.findByText('INV-000043.pdf')).toBeInTheDocument();
      expect(screen.getByText('INV-000042.pdf')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(order).toEqual(['main', 'vo']);
      const mainKey = send.mock.calls[0][0].idempotencyKey;
      expect(vo).toHaveBeenCalledWith({
        recipient: '+252615555555',
        idempotencyKey: `${mainKey}:inv2`,
      });
      expect(onSent).toHaveBeenCalledTimes(2);
      expect(await screen.findByText(/Sent 2 invoices on WhatsApp/)).toBeInTheDocument();
    });

    it('shows the outcome per invoice and a retry sends only what did not go', async () => {
      const user = userEvent.setup();
      const send = vi.fn().mockResolvedValue(message());
      const vo = vi
        .fn()
        .mockResolvedValueOnce(
          message({
            id: 'm2',
            status: 'FAILED',
            sentAt: null,
            errorMessage: 'WhatsApp could not accept the attached document.',
          }),
        )
        .mockResolvedValueOnce(message({ id: 'm2' }));
      const { onClose } = renderDialog({
        send,
        extraItems: [{ key: 'inv2', label: 'INV-000043.pdf', send: vo }],
      });
      await user.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));
      const results = await screen.findByRole('list', { name: 'What was sent' });
      expect(results).toHaveTextContent('Sent');
      expect(results).toHaveTextContent('WhatsApp could not accept the attached document.');
      expect(onClose).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(send).toHaveBeenCalledTimes(1);
      expect(vo).toHaveBeenCalledTimes(2);
      expect(vo.mock.calls[1][0].idempotencyKey).toBe(vo.mock.calls[0][0].idempotencyKey);
    });
  });
});
