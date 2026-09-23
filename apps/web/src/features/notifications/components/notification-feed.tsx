'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BellOff } from 'lucide-react';
import { Alert, Button, EmptyState, SkeletonTable } from '@erp/ui';
import type { NotificationItem } from '@erp/types';

import { useMarkAllRead, useMarkRead, useNotifications } from '../hooks/use-notifications';
import { NotificationRow } from './notification-row';

const PAGE_SIZE = 20;

/**
 * The full-page notification feed (`/notifications`).
 *
 * The whole feed, newest first, paged. Reuses `NotificationRow` so a row here behaves exactly like
 * one in the bell — activating it marks it read and follows its `actionUrl`. "Load more" grows the
 * page size rather than swapping pages, so the reader never loses the rows they were looking at.
 * Mobile-first: a single stacked column that already fits 375px, wider only in that it has room.
 */
export function NotificationFeed() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, isPending, isError, refetch, isFetching } = useNotifications({
    unread: false,
    page: 1,
    limit,
  });
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const unreadTotal = data?.unreadTotal ?? 0;
  const hasMore = items.length < total;

  function activate(item: NotificationItem) {
    if (item.readAt === null) markRead.mutate(item.id);
    if (item.actionUrl) router.push(item.actionUrl);
  }

  if (isPending) {
    return <SkeletonTable columns={2} rows={6} label={t('loading')} />;
  }

  if (isError) {
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {t('retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BellOff size={22} aria-hidden="true" />}
        title={t('empty')}
        description={t('emptyHint')}
      />
    );
  }

  return (
    <div className="space-y-4">
      {unreadTotal > 0 ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            {t('markAllRead')}
          </Button>
        </div>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface">
        {items.map((item) => (
          <li key={item.id}>
            <NotificationRow item={item} onActivate={activate} />
          </li>
        ))}
      </ul>

      {hasMore ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
            disabled={isFetching}
          >
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
