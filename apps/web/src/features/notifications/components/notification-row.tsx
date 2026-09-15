'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import type { NotificationItem } from '@erp/types';

import { relativeTime } from '@/lib/format';

import { notificationCopy, notificationTone } from '../presentation';

/** Maps a badge tone to the dot colour class. The label carries meaning; the dot is a scan aid. */
const DOT_CLASS: Record<ReturnType<typeof notificationTone>, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-brand-primary',
  neutral: 'bg-muted-foreground',
  live: 'bg-success',
  accent: 'bg-historical',
  historical: 'bg-historical',
};

export interface NotificationRowProps {
  item: NotificationItem;
  /** Click handler — the bell marks-read-then-navigates, the feed does the same. */
  onActivate: (item: NotificationItem) => void;
  /** Renders as a button (dropdown) vs a list row on the page; both are clickable. */
  className?: string;
}

/**
 * One notification: a severity dot, the localized title + impact, and a relative time.
 *
 * Shared by the bell dropdown and the full-page feed so the two never drift. The row is a real
 * `<button>` — activating it is `onActivate`, which marks the item read and navigates to its
 * `actionUrl`. Unread rows carry a subtle emphasis so a scan finds them.
 */
export function NotificationRow({ item, onActivate, className }: NotificationRowProps) {
  const t = useTranslations('notifications');
  const tone = notificationTone(item.severity);
  const { titleKey, impactKey, values } = notificationCopy(item);
  const unread = item.readAt === null;
  const when = relativeTime(item.createdAt);

  return (
    <button
      type="button"
      onClick={() => onActivate(item)}
      className={cn(
        'flex w-full items-start gap-3 px-3 py-2.5 text-start transition-colors',
        'hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none',
        unread && 'bg-brand-accent/40',
        className,
      )}
    >
      <span
        className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT_CLASS[tone])}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm text-foreground',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {t(titleKey, values)}
          </span>
          {when ? (
            <span className="shrink-0 whitespace-nowrap text-caption text-muted-foreground">
              {when}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-caption text-muted-foreground">
          {t(impactKey, values)}
        </span>
      </span>
    </button>
  );
}
