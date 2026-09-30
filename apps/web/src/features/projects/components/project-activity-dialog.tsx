'use client';

import { useTranslations } from 'next-intl';
import {
  ActivityTimeline,
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  Skeleton,
} from '@erp/ui';
import { renderNextLink } from '@/components/render-next-link';

import { useProjectActivityEntries } from '../activity-labels';
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
  const toEntries = useProjectActivityEntries();
  const query = useProjectActivity(projectId, open);
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];

  // One sentence per event — **who** did what to which record (linked when it has a page), then
  // when — built by the same hook as the Overview rail, so the two read as one list.
  const entries = toEntries(events);

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
            <ActivityTimeline entries={entries} label={t('title')} renderLink={renderNextLink} />
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
