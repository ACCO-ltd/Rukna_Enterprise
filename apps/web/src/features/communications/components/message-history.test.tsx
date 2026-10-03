import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OutboundMessageView } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import * as api from '../api';
import { shouldPollMessages } from '../message-status';
import { MessageHistory } from './message-history';

vi.mock('../api', () => ({
  listCommunications: vi.fn(),
  resolveCommunication: vi.fn(),
}));

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

function renderHistory(canResolve = true) {
  renderWithProviders(
    <MessageHistory resourceType="client_invoice" resourceId="inv1" canResolve={canResolve} />,
    {
      withToast: true,
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageHistory', () => {
  it('shows a status pill per message', async () => {
    vi.mocked(api.listCommunications).mockResolvedValue([
      message({ id: 'a', status: 'READ', readAt: '2026-10-02T10:05:00.000Z' }),
      message({ id: 'b', status: 'DELIVERED' }),
      message({ id: 'c', status: 'QUEUED' }),
      message({
        id: 'd',
        status: 'FAILED',
        errorMessage: 'This number cannot receive WhatsApp messages from us.',
      }),
    ]);
    renderHistory();
    expect(await screen.findByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText('Sending')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(
      screen.getByText('This number cannot receive WhatsApp messages from us.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^WhatsApp to /)).toHaveLength(4);
    expect(api.listCommunications).toHaveBeenCalledWith('client_invoice', 'inv1');
  });

  it('offers Mark as sent / not sent on an Unknown message and resolves it', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCommunications).mockResolvedValue([
      message({ status: 'UNKNOWN', sentAt: null }),
    ]);
    vi.mocked(api.resolveCommunication).mockResolvedValue(message({ status: 'SENT' }));
    renderHistory();
    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() =>
      expect(api.resolveCommunication).toHaveBeenCalledWith('m1', { outcome: 'SENT' }),
    );
    expect(await screen.findByText('Marked as sent')).toBeInTheDocument();
  });

  it('marks an Unknown message as not sent', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCommunications).mockResolvedValue([
      message({ status: 'UNKNOWN', sentAt: null }),
    ]);
    vi.mocked(api.resolveCommunication).mockResolvedValue(message({ status: 'FAILED' }));
    renderHistory();
    await user.click(await screen.findByRole('button', { name: 'Mark as not sent' }));
    await waitFor(() =>
      expect(api.resolveCommunication).toHaveBeenCalledWith('m1', { outcome: 'FAILED' }),
    );
  });

  it('shows a resolve error in place', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCommunications).mockResolvedValue([
      message({ status: 'UNKNOWN', sentAt: null }),
    ]);
    vi.mocked(api.resolveCommunication).mockRejectedValue(
      new Error('Only a message WhatsApp never confirmed can be marked by hand.'),
    );
    renderHistory();
    await user.click(await screen.findByRole('button', { name: 'Mark as sent' }));
    expect(
      await screen.findByText('Only a message WhatsApp never confirmed can be marked by hand.'),
    ).toBeInTheDocument();
  });

  it('hides the resolve actions from a viewer who may not resolve', async () => {
    vi.mocked(api.listCommunications).mockResolvedValue([
      message({ status: 'UNKNOWN', sentAt: null }),
    ]);
    renderHistory(false);
    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument();
  });
});

describe('shouldPollMessages', () => {
  const now = Date.parse('2026-10-02T10:02:00.000Z');

  it('polls while a recent message can still get a tick', () => {
    expect(shouldPollMessages([message({ status: 'SENT' })], now)).toBe(true);
    expect(shouldPollMessages([message({ status: 'QUEUED', sentAt: null })], now)).toBe(true);
    expect(
      shouldPollMessages(
        [message({ status: 'DELIVERED', deliveredAt: '2026-10-02T10:01:00.000Z' })],
        now,
      ),
    ).toBe(true);
  });

  it('stops for final statuses and after a few minutes', () => {
    expect(
      shouldPollMessages([message({ status: 'READ', readAt: '2026-10-02T10:01:00.000Z' })], now),
    ).toBe(false);
    expect(shouldPollMessages([message({ status: 'FAILED' })], now)).toBe(false);
    expect(shouldPollMessages([message({ status: 'UNKNOWN', sentAt: null })], now)).toBe(false);
    expect(shouldPollMessages([message({ status: 'SENT' })], now + 10 * 60_000)).toBe(false);
    expect(shouldPollMessages(undefined, now)).toBe(false);
    expect(shouldPollMessages([], now)).toBe(false);
  });
});
