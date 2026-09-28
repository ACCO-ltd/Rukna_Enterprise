'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Avatar,
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from '@erp/ui';
import type { ProjectActivityEventResponse } from '@erp/types';

import { formatDateTime } from '@/lib/format';

import { useActivityLabel } from '../activity-labels';
import { useProjectActivity } from '../hooks/use-project';

/**
 * The project's full history for any project member (`GET /projects/:id/activity`) — the
 * "View all" of the Overview's Latest activity. A side sheet, like the BOQ timeline, because it
 * is a look-aside: the reader stays on the Overview and closes it to carry on.
 *
 * The server decides which events this reader may see (contract events need `view:contract`,
 * BOQ events `view:boq`), so the sheet renders what it is given and pages with "Load more".
 */
export function ProjectActivitySheet({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.projects.activity');
  const common = useTranslations('common');
  const query = useProjectActivity(projectId, open);
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-md" closeLabel={t('close')}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {query.isPending ? (
            <div className="space-y-3" role="status" aria-label={common('loading')}>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : query.isError && events.length === 0 ? (
            <Alert variant="error" messages={[t('loadFailed')]}>
              <Button variant="outline" onClick={() => void query.refetch()}>
                {common('grid.retry')}
              </Button>
            </Alert>
          ) : events.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <>
              <ActivityList events={events} />
              <div className="mt-4">
                {query.hasNextPage ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void query.fetchNextPage()}
                    disabled={query.isFetchingNextPage}
                  >
                    {query.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
                  </Button>
                ) : (
                  <p className="text-caption text-muted-foreground">{t('end')}</p>
                )}
                {query.isFetchNextPageError ? (
                  <p className="mt-2 text-caption text-danger" role="alert">
                    {t('loadFailed')}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** Who · what, then when — the same line the Overview rail uses, so the two read as one list. */
export function ActivityList({ events }: { events: readonly ProjectActivityEventResponse[] }) {
  const label = useActivityLabel();
  const locale = useLocale() as 'en' | 'ar';

  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="flex min-w-0 gap-2.5">
          <Avatar name={event.actor.name} size="sm" className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-body-sm text-foreground">
              <span className="font-semibold">{event.actor.name}</span>
              <span className="text-muted-foreground"> · </span>
              {label(event)}
            </p>
            <p className="text-caption text-muted-foreground">
              <time dateTime={event.occurredAt}>
                {formatDateTime(event.occurredAt, locale) ?? ''}
              </time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
