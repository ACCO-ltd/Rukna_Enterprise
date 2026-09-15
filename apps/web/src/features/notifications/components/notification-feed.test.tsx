import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationItem, NotificationListResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as hooks from '../hooks/use-notifications';

import { NotificationFeed } from './notification-feed';

vi.mock('../hooks/use-notifications', () => ({
  useNotifications: vi.fn(),
  useMarkRead: vi.fn(),
  useMarkAllRead: vi.fn(),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n-1',
    kind: 'CLIENT_INVOICE_OVERDUE',
    severity: 'WARNING',
    projectId: 'p-1',
    contractId: null,
    resourceType: 'ClientInvoice',
    resourceId: 'inv-1',
    contextData: { invoiceNumber: 'INV-0007', daysOverdue: 12 },
    actionUrl: '/finance/accounting/invoices/inv-1',
    readAt: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

function listResponse(overrides: Partial<NotificationListResponse> = {}): NotificationListResponse {
  return {
    items: [item()],
    page: 1,
    limit: 20,
    total: 1,
    unreadTotal: 1,
    ...overrides,
  };
}

function stubHooks(options: {
  list?: NotificationListResponse;
  pending?: boolean;
  markReadMutate?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(hooks.useNotifications).mockReturnValue({
    data: options.pending ? undefined : (options.list ?? listResponse()),
    isPending: options.pending ?? false,
    isError: false,
    refetch: vi.fn(),
    isFetching: false,
  } as unknown as ReturnType<typeof hooks.useNotifications>);

  vi.mocked(hooks.useMarkRead).mockReturnValue({
    mutate: options.markReadMutate ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useMarkRead>);

  vi.mocked(hooks.useMarkAllRead).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useMarkAllRead>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationFeed', () => {
  it('renders each notification with its localized title and impact', () => {
    stubHooks();
    renderWithProviders(<NotificationFeed />, { withToast: true });

    expect(screen.getByText('Invoice overdue: INV-0007')).toBeInTheDocument();
    expect(screen.getByText('12 days overdue')).toBeInTheDocument();
  });

  it('renders the empty state when there are no notifications', () => {
    stubHooks({ list: listResponse({ items: [], total: 0, unreadTotal: 0 }) });
    renderWithProviders(<NotificationFeed />, { withToast: true });

    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it('shows a loading skeleton while pending', () => {
    stubHooks({ pending: true });
    renderWithProviders(<NotificationFeed />, { withToast: true });

    expect(screen.getByText('Loading notifications')).toBeInTheDocument();
  });

  it('activating a row marks it read and navigates to its actionUrl', async () => {
    const user = userEvent.setup();
    const markReadMutate = vi.fn();
    stubHooks({ markReadMutate });
    renderWithProviders(<NotificationFeed />, { withToast: true });

    await user.click(screen.getByText('Invoice overdue: INV-0007'));

    expect(markReadMutate).toHaveBeenCalledWith('n-1');
    expect(push).toHaveBeenCalledWith('/finance/accounting/invoices/inv-1');
  });

  it('offers "Load more" only when there are more items than are loaded', () => {
    stubHooks({ list: listResponse({ items: [item()], total: 5 }) });
    renderWithProviders(<NotificationFeed />, { withToast: true });
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('does not offer "Load more" when everything is loaded', () => {
    stubHooks({ list: listResponse({ items: [item()], total: 1 }) });
    renderWithProviders(<NotificationFeed />, { withToast: true });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});
