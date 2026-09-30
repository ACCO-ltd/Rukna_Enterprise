'use client';

import { useTranslations } from 'next-intl';
import {
  ActivityTimeline,
  Alert,
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

import { renderNextLink } from '@/components/render-next-link';

import { useProjectActivityEntries } from '../activity-labels';
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

/**
 * One sentence per event on the shared `ActivityTimeline` — **who** did what to which record
 * (linked when it has a page), then when — the same reading as the Overview rail.
 */
export function ActivityList({ events }: { events: readonly ProjectActivityEventResponse[] }) {
  const toEntries = useProjectActivityEntries();
  return <ActivityTimeline entries={toEntries(events)} renderLink={renderNextLink} />;
}
