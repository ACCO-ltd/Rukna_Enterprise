import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationItem, NotificationListResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as hooks from '../hooks/use-notifications';

import { NotificationBell } from './notification-bell';

// Mock the hooks module: query hooks return canned data, mutation hooks return a spyable mutate.
vi.mock('../hooks/use-notifications', () => ({
  useUnreadCount: vi.fn(),
  useNotifications: vi.fn(),
  useMarkRead: vi.fn(),
  useMarkAllRead: vi.fn(),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

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

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n-1',
    kind: 'STAGE_PAYMENT_OVERDUE',
    severity: 'URGENT',
    projectId: 'p-1',
    contractId: 'c-1',
    resourceType: 'ContractPaymentInstallment',
    resourceId: 'inst-1',
    contextData: { stageName: 'Structure', contractNumber: 'CT-001', dueInDays: 3 },
    actionUrl: '/projects/p-1/commercial/payment-schedule',
    readAt: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

function listResponse(overrides: Partial<NotificationListResponse> = {}): NotificationListResponse {
  return {
    items: [item()],
    page: 1,
    limit: 8,
    total: 1,
    unreadTotal: 1,
    ...overrides,
  };
}

function stubHooks(options: {
  count?: number;
  list?: NotificationListResponse;
  listPending?: boolean;
  markReadMutate?: ReturnType<typeof vi.fn>;
  markAllReadMutate?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(hooks.useUnreadCount).mockReturnValue({
    data: { count: options.count ?? 0 },
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof hooks.useUnreadCount>);

  vi.mocked(hooks.useNotifications).mockReturnValue({
    data: options.listPending ? undefined : (options.list ?? listResponse()),
    isPending: options.listPending ?? false,
    isError: false,
  } as unknown as ReturnType<typeof hooks.useNotifications>);

  vi.mocked(hooks.useMarkRead).mockReturnValue({
    mutate: options.markReadMutate ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useMarkRead>);

  vi.mocked(hooks.useMarkAllRead).mockReturnValue({
    mutate: options.markAllReadMutate ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useMarkAllRead>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationBell — the unread badge', () => {
  it('shows the unread count on the badge', () => {
    stubHooks({ count: 4 });
    renderWithProviders(<NotificationBell />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('hides the badge entirely at zero', () => {
    stubHooks({ count: 0 });
    renderWithProviders(<NotificationBell />);
    // The bell button is present, but no numeric badge is rendered.
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('caps the badge at 99+', () => {
    stubHooks({ count: 250 });
    renderWithProviders(<NotificationBell />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });
});

describe('NotificationBell — the dropdown feed', () => {
  it('renders localized items with their severity tone dot', async () => {
    const user = userEvent.setup();
    stubHooks({ count: 1 });
    renderWithProviders(<NotificationBell />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    // The title/impact are interpolated from contextData via the notifications catalogue.
    expect(await screen.findByText('Stage overdue: Structure')).toBeInTheDocument();
    expect(screen.getByText('CT-001 · 3 days overdue')).toBeInTheDocument();
  });

  it('renders the empty state when there is nothing to show', async () => {
    const user = userEvent.setup();
    stubHooks({ count: 0, list: listResponse({ items: [], total: 0, unreadTotal: 0 }) });
    renderWithProviders(<NotificationBell />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it('shows a loading state while the feed is pending', async () => {
    const user = userEvent.setup();
    stubHooks({ count: 1, listPending: true });
    renderWithProviders(<NotificationBell />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Loading notifications')).toBeInTheDocument();
  });
});

describe('NotificationBell — activating a row', () => {
  it('marks the row read and navigates to its actionUrl', async () => {
    const user = userEvent.setup();
    const markReadMutate = vi.fn();
    stubHooks({ count: 1, markReadMutate });
    renderWithProviders(<NotificationBell />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByText('Stage overdue: Structure'));

    expect(markReadMutate).toHaveBeenCalledWith('n-1');
    expect(push).toHaveBeenCalledWith('/projects/p-1/commercial/payment-schedule');
  });

  it('does not mark read again for an already-read row, but still navigates', async () => {
    const user = userEvent.setup();
    const markReadMutate = vi.fn();
    stubHooks({
      count: 0,
      list: listResponse({
        items: [item({ readAt: '2026-09-11T00:00:00.000Z' })],
        unreadTotal: 0,
      }),
      markReadMutate,
    });
    renderWithProviders(<NotificationBell />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByText('Stage overdue: Structure'));

    expect(markReadMutate).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/projects/p-1/commercial/payment-schedule');
  });

  it('marks read but does not navigate when the notification has no actionUrl', async () => {
    const user = userEvent.setup();
    const markReadMutate = vi.fn();
    stubHooks({
      count: 1,
      list: listResponse({ items: [item({ actionUrl: null })] }),
      markReadMutate,
    });
    renderWithProviders(<NotificationBell />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByText('Stage overdue: Structure'));

    expect(markReadMutate).toHaveBeenCalledWith('n-1');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('NotificationBell — mark all read', () => {
  it('calls the mark-all-read mutation from the footer control', async () => {
    const user = userEvent.setup();
    const markAllReadMutate = vi.fn();
    stubHooks({ count: 2, markAllReadMutate });
    renderWithProviders(<NotificationBell />, { withToast: true });

    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(markAllReadMutate).toHaveBeenCalledTimes(1));
  });
});
