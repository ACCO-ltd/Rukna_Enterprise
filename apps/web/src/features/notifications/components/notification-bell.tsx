'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import {
  Badge,
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from '@erp/ui';
import type { NotificationItem } from '@erp/types';

import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../hooks/use-notifications';
import { NotificationRow } from './notification-row';

/** How many recent items the dropdown shows before "View all" takes over. */
const RECENT_LIMIT = 8;

/**
 * The notification bell (ADR-031) — the top-bar's live indicator.
 *
 * A bell button carrying a danger badge with the caller's unread total, hidden entirely at zero so
 * the bar stays quiet when there is nothing to act on. The count comes from `useUnreadCount`, which
 * polls every 60s and on focus — the count moves without the dropdown ever being opened.
 *
 * Opening the bell reads the recent feed (all items, unread or not, newest first). A row marks
 * itself read and navigates to its `actionUrl`; the footer offers "Mark all read" and a link to the
 * full page. The list read only fires while the popover is open (`enabled`), so a closed bell costs
 * one cheap count poll, not a full list fetch.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { data: countData } = useUnreadCount();
  const unread = countData?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('openLabel')}
          className={cn(
            'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-control',
            'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
          )}
        >
          <Bell size={18} aria-hidden="true" />
          {unread > 0 ? (
            <Badge
              tone="danger"
              aria-label={t('unreadBadgeLabel', { count: unread })}
              className="absolute -end-1 -top-1 min-h-0 min-w-4 justify-center rounded-full px-1 py-0 text-micro leading-4"
            >
              {unread > 99 ? '99+' : unread}
            </Badge>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
        aria-label={t('title')}
      >
        <BellPanel onClose={() => setOpen(false)} onNavigate={(url) => router.push(url)} />
      </PopoverContent>
    </Popover>
  );
}

function BellPanel({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (url: string) => void;
}) {
  const t = useTranslations('notifications');
  const { data, isPending, isError } = useNotifications({ unread: false, page: 1, limit: RECENT_LIMIT });
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = data?.items ?? [];
  const unreadTotal = data?.unreadTotal ?? 0;

  function activate(item: NotificationItem) {
    if (item.readAt === null) markRead.mutate(item.id);
    onClose();
    // Guard null: a notification without a deep link just marks read and closes.
    if (item.actionUrl) onNavigate(item.actionUrl);
  }

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-sm font-semibold text-foreground">{t('title')}</p>
        {unreadTotal > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            {t('markAllRead')}
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <div role="status" aria-live="polite" className="space-y-2 p-3">
            <span className="sr-only">{t('loading')}</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="mt-1 size-2 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('loadFailed')}</p>
        ) : items.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm font-medium text-foreground">{t('empty')}</p>
            <p className="mt-1 text-caption text-muted-foreground">{t('emptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} onActivate={activate} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-3 py-2">
        <Link
          href="/notifications"
          onClick={onClose}
          className="inline-flex min-h-9 items-center text-sm font-semibold text-brand-primary hover:text-brand-primary-hover"
        >
          {t('viewAll')}
        </Link>
      </div>
    </div>
  );
}
