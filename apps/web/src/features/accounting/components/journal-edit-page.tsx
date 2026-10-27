'use client';

/**
 * Edit a draft journal, or correct a rejected one — the journal loaded into `JournalForm`.
 *
 * Only the preparer edits a DRAFT or REJECTED journal (`canEditJournal`, mirroring
 * `ManualJournalService.update`); anyone else, or a journal past that point, gets the reason and a
 * way back rather than a form the server would refuse.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { useSession } from '@/features/auth/session/use-session';
import { ApiError } from '@/lib/api-client';

import { useJournal } from '../hooks/use-accounting';
import { canEditJournal } from '../journal-entry';
import { JournalForm } from './journal-form';

export function JournalEditPage({ journalId }: { journalId: string }) {
  const t = useTranslations('accounting.journalDetail');
  const tCommon = useTranslations('common');
  const journal = useJournal(journalId);
  const userId = useSession().user?.id ?? null;

  if (journal.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  const detailHref = `/finance/accounting/journals/${journalId}`;

  if (journal.isError) {
    const notFound = journal.error instanceof ApiError && journal.error.status === 404;
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/finance/accounting/journals">{t('back')}</Link>
        </Button>
      </div>
    );
  }

  if (!canEditJournal(journal.data, userId)) {
    return (
      <div className="space-y-4">
        <Alert variant="warning" messages={[t('notEditable')]} />
        <Button variant="outline" asChild>
          <Link href={detailHref}>{t('backToJournal')}</Link>
        </Button>
      </div>
    );
  }

  return <JournalForm journal={journal.data} />;
}
