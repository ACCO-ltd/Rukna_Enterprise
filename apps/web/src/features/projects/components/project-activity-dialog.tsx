'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  ActivityTimeline,
  type ActivityTimelineEntry,
  Alert,
  Avatar,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  Skeleton,
} from '@erp/ui';
import type { ProjectActivityEventResponse } from '@erp/types';

import { formatDateTime } from '@/lib/format';

import { useActivityLabel } from '../activity-labels';
import { useProjectActivity } from '../hooks/use-project';

/**
 * The project's full history for any project member (`GET /projects/:id/activity`) — the
 * "View all" of the Overview's Latest activity. A read-only `FormDialog` at `md` drawn with the
 * shared `ActivityTimeline` (ADR-039: history in a dialog), with Close as its only action.
 *
 * The server decides which events this reader may see (contract events need `view:contract`,
 * BOQ events `view:boq`), so the dialog renders what it is given and pages with "Load more".
 */
export function ProjectActivityDialog({
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
  const label = useActivityLabel();
  const locale = useLocale() as 'en' | 'ar';
  const query = useProjectActivity(projectId, open);
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];

  // "Name · what happened" — the same reading as the Overview rail, so the two feel like one list.
  const entries: ActivityTimelineEntry[] = events.map((event) => ({
    id: event.id,
    actor: event.actor.name,
    action: (
      <>
        <span className="text-muted-foreground">· </span>
        {label(event)}
      </>
    ),
    at: formatDateTime(event.occurredAt, locale) ?? '',
    dateTime: event.occurredAt,
  }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      initialFocus="dialog"
      title={t('title')}
      subtitle={t('description')}
      closeLabel={t('close')}
    >
      <FormDialogBody>
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
          <div>
            <ActivityTimeline entries={entries} label={t('title')} />
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
          </div>
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline">
            {t('close')}
          </Button>
        </FormDialogClose>
      </FormDialogFooter>
    </FormDialog>
  );
}

/**
 * Who · what, then when — the Overview rail's own list. Left as it is here on purpose: the rail
 * moves onto `ActivityTimeline` with the rest of the app's timelines, not in this change.
 */
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
