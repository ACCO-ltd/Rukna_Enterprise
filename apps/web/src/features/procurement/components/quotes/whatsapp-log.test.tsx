import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StaffAlertLogEntry } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { WhatsAppLog } from './whatsapp-log';

const entry = (over: Partial<StaffAlertLogEntry>): StaffAlertLogEntry => ({
  id: 'm1',
  recipientName: 'Fadumo Ali',
  recipientPhoneMasked: '…678',
  purpose: 'QUOTE_READY',
  status: 'DELIVERED',
  queuedAt: '2026-10-10T07:41:00.000Z',
  sentAt: '2026-10-10T07:42:00.000Z',
  deliveredAt: '2026-10-10T07:42:30.000Z',
  readAt: null,
  failedAt: null,
  failureReason: null,
  ...over,
});

describe('WhatsAppLog (ADR-044 phase 2)', () => {
  it('renders nothing without alerts (alerts off, nobody opted in, older server)', () => {
    const { container: none } = renderWithProviders(<WhatsAppLog messages={undefined} />);
    expect(none).toBeEmptyDOMElement();
    const { container: empty } = renderWithProviders(<WhatsAppLog messages={[]} />);
    expect(empty).toBeEmptyDOMElement();
  });

  it('lists who got which alert and how far it got, newest first, with the masked number only', () => {
    renderWithProviders(
      <WhatsAppLog
        messages={[
          entry({}),
          entry({
            id: 'm2',
            recipientName: 'Hodan Abdi',
            recipientPhoneMasked: '…123',
            purpose: 'QUOTE_REMINDER',
            status: 'FAILED',
            sentAt: null,
            deliveredAt: null,
            failedAt: '2026-10-10T09:00:00.000Z',
            failureReason: 'This number cannot receive WhatsApp messages from us (not on WhatsApp or not allowed).',
          }),
        ]}
      />,
    );
    const section = screen.getByRole('region', { name: 'WhatsApp' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // Newest first: the reminder.
    expect(items[0]).toHaveTextContent('Reminder');
    expect(items[0]).toHaveTextContent('Hodan Abdi');
    expect(items[0]).toHaveTextContent('Not sent');
    expect(items[0]).toHaveTextContent('cannot receive WhatsApp');
    expect(items[1]).toHaveTextContent('Quotes ready');
    expect(items[1]).toHaveTextContent('Fadumo Ali');
    expect(items[1]).toHaveTextContent('…678');
    expect(items[1]).toHaveTextContent('Delivered');
    // The time shown is when it got furthest (delivered).
    expect(items[1].querySelector('time')).toHaveAttribute('datetime', '2026-10-10T07:42:30.000Z');
  });

  it('a queued alert says so; a read one says Read', () => {
    renderWithProviders(
      <WhatsAppLog
        messages={[
          entry({ id: 'q', status: 'QUEUED', sentAt: null, deliveredAt: null }),
          entry({ id: 'r', status: 'READ', readAt: '2026-10-10T08:00:00.000Z', purpose: 'QUOTE_CHOSEN' }),
        ]}
      />,
    );
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Store chosen')).toBeInTheDocument();
  });

  it('labels the payment alerts in words (ADR-045), never a raw key', () => {
    renderWithProviders(
      <WhatsAppLog
        messages={[
          entry({ id: 'p1', purpose: 'QUOTE_CASH_RELEASED' as never }),
          entry({ id: 'p2', purpose: 'QUOTE_PAY_NEEDED' as never }),
          entry({ id: 'p3', purpose: 'QUOTE_SUPPLIER_PAID' as never }),
        ] as never}
      />,
    );
    expect(screen.getByText('Cash released')).toBeInTheDocument();
    expect(screen.getByText('Payment needed')).toBeInTheDocument();
    expect(screen.getByText('Supplier paid')).toBeInTheDocument();
    expect(screen.queryByText(/QUOTE_/)).not.toBeInTheDocument();
  });
});
