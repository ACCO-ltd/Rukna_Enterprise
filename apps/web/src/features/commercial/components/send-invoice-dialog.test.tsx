import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';

import * as commercialApi from '../api/commercial-api';
import { SendInvoiceDialog } from './send-invoice-dialog';

vi.mock('../api/commercial-api', () => ({
  recordPackageDelivery: vi.fn(),
  getIssuedInvoiceDocument: vi.fn(),
}));

function renderDialog(overrides: { onClose?: () => void; onSent?: () => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSent = overrides.onSent ?? vi.fn();
  renderWithProviders(
    <SendInvoiceDialog
      open
      onClose={onClose}
      onSent={onSent}
      projectId="p1"
      installmentId="inst-2"
      invoiceId="inv-1"
      invoiceNumber="INV-0042"
    />,
  );
  return { onClose, onSent };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SendInvoiceDialog — record how an issued invoice reached the client', () => {
  it('names the invoice and asks how it was sent before offering the primary', () => {
    renderDialog();
    expect(screen.getByText('Record how invoice INV-0042 reached the client.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument();
    expect(screen.getByText('Choose how it was sent to record the delivery.')).toBeInTheDocument();
    for (const method of ['WhatsApp', 'Email', 'Hand delivered', 'Other']) {
      expect(screen.getByRole('radio', { name: new RegExp(method) })).toBeInTheDocument();
    }
  });

  it('records an email delivery against the stage package and closes', async () => {
    const user = userEvent.setup();
    vi.mocked(commercialApi.recordPackageDelivery).mockResolvedValue({ deliveries: [] });
    const { onClose, onSent } = renderDialog();

    await user.click(screen.getByRole('radio', { name: /Email/ }));
    await user.type(screen.getByLabelText('Sent to (email)'), 'ap@client.so');
    await user.type(screen.getByLabelText('Note'), 'Sent with cover letter');
    await user.click(screen.getByRole('button', { name: 'Mark as sent' }));

    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(commercialApi.recordPackageDelivery).toHaveBeenCalledWith(
      'p1',
      'inst-2',
      expect.objectContaining({
        method: 'EMAIL',
        recipient: 'ap@client.so',
        note: 'Sent with cover letter',
        sentAt: expect.any(String),
      }),
    );
  });

  it('shows the server error and stays open', async () => {
    const user = userEvent.setup();
    vi.mocked(commercialApi.recordPackageDelivery).mockRejectedValue(new Error('Invoice is not posted'));
    const { onClose } = renderDialog();

    await user.click(screen.getByRole('radio', { name: /Hand delivered/ }));
    await user.click(screen.getByRole('button', { name: 'Mark as sent' }));

    expect(await screen.findByText('Invoice is not posted')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('WhatsApp needs a number before it can open a chat', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('radio', { name: /WhatsApp/ }));
    expect(screen.getByText("Enter the client's WhatsApp number to open a chat.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Client's WhatsApp number"), '+252 61 234 5678');
    expect(screen.getByRole('button', { name: 'Open WhatsApp' })).toBeInTheDocument();
  });
});
