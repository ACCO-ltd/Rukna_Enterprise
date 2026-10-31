'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import {
  Alert,
  Button,
  DatePicker,
  DefinitionList,
  DefinitionRow,
  EmptyState,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  Notice,
  RecordHeader,
  RecordLayout,
  RecordPanel,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { LoadError } from '@/components/load-error';
import { useSession } from '@/features/auth/session/use-session';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';

import { indexAccounts, lineAccountLabel } from '../account-display';
import { useAccounts, useJournal, useJournalAction } from '../hooks/use-accounting';
import { todayWireDate } from '../invoice-overdue';
import { availableActions, canEditJournal, entryTotals } from '../journal-entry';
import type { JournalAction } from '../journal-entry';
import { journalHref, sourceDocumentHref, sourceKey } from '../journal-source';
import type { JournalEntry } from '../types';
import { JournalStatusBadge } from './journal-status-badge';
import { AttachmentsPanel } from '@/features/finance-attachments/attachments-panel';

/** Actions confirmed in a plain dialog; reverse has its own, with a date. */
type ConfirmedAction = Exclude<JournalAction, 'reverse'>;
const REASON_REQUIRED: Partial<Record<JournalAction, true>> = { reject: true, cancel: true };

const failure = (error: unknown, fallback: string) => (error instanceof ApiError && error.message ? error.message : fallback);

/**
 * GL-J — one journal: its lines, who prepared, approved and posted it, and the journals around it
 * (the reversal that undid it, or the journal it undoes). The actions its status allows sit in the
 * header; a journal that has not posted can be cancelled.
 */
export function JournalDetail({ journalId }: { journalId: string }) {
  const t = useTranslations('accounting.journalDetail');
  const tSource = useTranslations('accounting.journalBook.source');
  const locale = useLocale() as 'en';

  const journal = useJournal(journalId);
  // Names the accounts on a draft, whose line snapshots stay empty until it posts.
  const accounts = useAccounts();
  const action = useJournalAction(journalId);
  const userId = useSession().user?.id ?? null;
  const router = useRouter();
  const [pending, setPending] = useState<ConfirmedAction | 'reverse' | null>(null);

  // G-1 — posting writes a new numbered entry and leaves the draft behind, empty, pointing at it.
  const replacedBy = journal.data?.replacedByJournalEntryId ?? null;
  useEffect(() => {
    if (replacedBy && replacedBy !== journalId) router.replace(journalHref(replacedBy));
  }, [replacedBy, journalId, router]);

  const accountsById = useMemo(() => indexAccounts(accounts.data ?? []), [accounts.data]);
  useModuleTrail(journal.data ? (journal.data.journalNumber ?? t('unnumbered')) : undefined);

  if (journal.isPending || (replacedBy && replacedBy !== journalId)) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{t('loading')}</span>
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }
  if (journal.isError) {
    if (journal.error instanceof ApiError && journal.error.status === 404) {
      return <EmptyState title={t('notFound')} action={<Button variant="outline" asChild><Link href="/finance/accounting/journals">{t('back')}</Link></Button>} />;
    }
    return <LoadError message={t('loadFailed')} onRetry={() => void journal.refetch()} />;
  }

  const entry = journal.data;
  const totals = entryTotals(entry);
  const usd = (minor: number) => formatMoney(fromMinorUnits(minor, MONEY_SCALE), entry.currencyCode, locale) ?? '';
  const reversal = entry.reversals?.[0] ?? null;
  const actions = availableActions(entry.status).filter((a) => a !== 'reverse' || (!reversal && !entry.reversalOfJournalEntryId));
  const editable = canEditJournal({ status: entry.status, createdBy: entry.preparedBy ?? entry.createdBy }, userId);
  const primary = actions.find((a) => a === 'submit' || a === 'approve' || a === 'post');
  const secondary = actions.filter((a) => a !== primary);
  const isManual = entry.sourceDocumentType === 'MANUAL_JOURNAL';
  const sourceHref = sourceDocumentHref(entry.sourceDocumentType, entry.sourceDocumentId);
  const errorText = action.isError ? failure(action.error, t('actions.failed')) : undefined;

  function run(type: ConfirmedAction, reason: string) {
    const done = { onSuccess: () => setPending(null) };
    switch (type) {
      case 'submit':
        return action.mutate({ type: 'submit' }, done);
      case 'approve':
        return action.mutate({ type: 'approve', payload: { approved: true } }, done);
      case 'reject':
        return action.mutate({ type: 'approve', payload: { approved: false, rejectionReason: reason } }, done);
      case 'cancel':
        return action.mutate({ type: 'cancel', reason }, done);
      case 'post':
        return action.mutate(
          { type: 'post' },
          {
            onSuccess: (result) => {
              setPending(null);
              const posted = (result as { journalEntryId?: string }).journalEntryId;
              if (posted && posted !== journalId) router.replace(journalHref(posted));
            },
          },
        );
    }
  }

  return (
    <RecordLayout
      header={
        <RecordHeader
          headingLevel="h2"
          breadcrumb={
            <Link href="/finance/accounting/journals" className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground">
              <ChevronLeft size={14} aria-hidden="true" />
              {t('back')}
            </Link>
          }
          title={entry.description}
          statusPlacement="title"
          status={<JournalStatusBadge status={entry.status} />}
          meta={
            <span className="flex flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground">
              <span className="font-mono font-medium text-foreground">{entry.journalNumber ?? t('unnumbered')}</span>
              <span>· {formatDate(entry.accountingDate, locale)}</span>
              <span>· {tSource(sourceKey(entry.sourceDocumentType))}</span>
            </span>
          }
          figure={{ label: t('amount'), value: <span className="tabular-nums">{usd(totals.debitMinor)}</span> }}
          actions={
            editable || actions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {primary ? (
                  <Button disabled={primary === 'post' && !totals.balanced} onClick={() => setPending(primary)}>
                    {t(`actions.${primary}`)}
                  </Button>
                ) : null}
                {editable ? (
                  <Button variant={entry.status === 'REJECTED' ? 'default' : 'outline'} asChild>
                    <Link href={`${journalHref(entry.id)}/edit`}>{entry.status === 'REJECTED' ? t('actions.correct') : t('actions.edit')}</Link>
                  </Button>
                ) : null}
                {secondary.map((type) => (
                  <Button key={type} variant={type === 'cancel' ? 'ghost' : 'outline'} onClick={() => setPending(type)}>
                    {t(`actions.${type}`)}
                  </Button>
                ))}
              </div>
            ) : undefined
          }
        />
      }
      banner={<JournalNotices entry={entry} balanced={totals.balanced} debit={usd(totals.debitMinor)} credit={usd(totals.creditMinor)} />}
      rail={
        <>
          <RecordPanel title={t('detailsTitle')}>
            <DefinitionList>
              <DefinitionRow label={t('number')}>
                <span className="font-mono">{entry.journalNumber ?? t('unnumbered')}</span>
              </DefinitionRow>
              <DefinitionRow label={t('accountingDate')}>{formatDate(entry.accountingDate, locale)}</DefinitionRow>
              <DefinitionRow label={t('documentDate')}>{formatDate(entry.documentDate, locale)}</DefinitionRow>
              {entry.autoReverseOn ? <DefinitionRow label={t('autoReverseOn')}>{formatDate(entry.autoReverseOn, locale)}</DefinitionRow> : null}
              <DefinitionRow label={t('source')}>
                {sourceHref ? (
                  <Link href={sourceHref} className="text-brand-primary hover:underline">{tSource(sourceKey(entry.sourceDocumentType))}</Link>
                ) : (
                  tSource(sourceKey(entry.sourceDocumentType))
                )}
              </DefinitionRow>
              {reversal ? (
                <DefinitionRow label={t('reversedByEntry')}>
                  <Link href={journalHref(reversal.id)} className="font-mono text-brand-primary hover:underline">{reversal.journalNumber}</Link>
                </DefinitionRow>
              ) : null}
              {entry.reversalOf ? (
                <DefinitionRow label={t('reverses')}>
                  <Link href={journalHref(entry.reversalOf.id)} className="font-mono text-brand-primary hover:underline">{entry.reversalOf.journalNumber}</Link>
                </DefinitionRow>
              ) : null}
            </DefinitionList>
          </RecordPanel>
          <RecordPanel title={t('peopleTitle')}>
            <DefinitionList>
              <DefinitionRow label={isManual ? t('preparedBy') : t('recordedBy')}>{entry.preparedByName ?? '—'}</DefinitionRow>
              {entry.submittedByName ? <DefinitionRow label={t('submittedBy')}>{entry.submittedByName}</DefinitionRow> : null}
              {entry.approvedByName ? <DefinitionRow label={t('approvedBy')}>{entry.approvedByName}</DefinitionRow> : null}
              {entry.status === 'POSTED' && entry.postedByName ? <DefinitionRow label={t('postedBy')}>{entry.postedByName}</DefinitionRow> : null}
            </DefinitionList>
          </RecordPanel>
        </>
      }
    >
      <LinesPanel entry={entry} accountsById={accountsById} usd={usd} totals={totals} />
      <AttachmentsPanel kind="JOURNAL" ownerId={journalId} />

      {action.isError && !pending ? <Alert variant="error" messages={[errorText ?? '']} /> : null}

      {pending === 'reverse' ? (
        <ReverseDialog
          entry={entry}
          isPending={action.isPending}
          errorMessage={errorText}
          onConfirm={(reversalDate, reason) => action.mutate({ type: 'reverse', payload: { reversalDate, reason } }, { onSuccess: () => setPending(null) })}
          onDismiss={() => {
            setPending(null);
            action.reset();
          }}
        />
      ) : pending ? (
        <ConfirmActionDialog
          title={t(`confirm.${pending}Title`)}
          description={t(`confirm.${pending}Body`)}
          confirmLabel={t(`actions.${pending}`)}
          reason={
            REASON_REQUIRED[pending]
              ? { required: true, label: t(`confirm.${pending}ReasonLabel`), maxLength: 500 }
              : undefined
          }
          destructive={pending === 'cancel'}
          isPending={action.isPending}
          errorMessage={errorText}
          onConfirm={(reason) => run(pending, reason)}
          onDismiss={() => {
            setPending(null);
            action.reset();
          }}
        />
      ) : null}
    </RecordLayout>
  );
}

/** Returned, cancelled, reversed, a reversal, or out of balance — one line each, with why. */
function JournalNotices({ entry, balanced, debit, credit }: { entry: JournalEntry; balanced: boolean; debit: string; credit: string }) {
  const t = useTranslations('accounting.journalDetail.notice');
  const locale = useLocale() as 'en';
  const reversal = entry.reversals?.[0] ?? null;
  const notices: React.ReactNode[] = [];
  if (entry.status === 'REJECTED' && entry.rejectionReason) {
    notices.push(<Notice key="rejected" tone="attention" title={t('rejectedTitle', { name: entry.rejectedByName ?? '—' })}>{entry.rejectionReason}</Notice>);
  }
  if (entry.status === 'CANCELLED') {
    notices.push(
      <Notice key="cancelled" tone="historical" title={t('cancelledTitle', { name: entry.cancelledByName ?? '—', date: formatDate(entry.cancelledAt ?? entry.createdAt, locale) ?? '' })}>
        {entry.cancellationReason}
      </Notice>,
    );
  }
  if (reversal) {
    notices.push(
      <Notice key="reversed" tone="historical" title={t('reversedTitle', { date: formatDate(reversal.accountingDate, locale) ?? '' })}>
        <Link href={journalHref(reversal.id)} className="font-mono text-brand-primary hover:underline">{reversal.journalNumber}</Link>
        {entry.reversalReason ? ` · ${entry.reversalReason}` : null}
      </Notice>,
    );
  }
  if (entry.reversalOf) {
    notices.push(
      <Notice key="reversal" tone="info" title={t('reversalTitle')}>
        <Link href={journalHref(entry.reversalOf.id)} className="font-mono text-brand-primary hover:underline">{entry.reversalOf.journalNumber}</Link>
      </Notice>,
    );
  }
  if (!balanced && entry.lines.length > 0 && entry.status !== 'CANCELLED') {
    notices.push(<Notice key="balance" tone="danger" title={t('unbalancedTitle')}>{t('unbalancedBody', { debit, credit })}</Notice>);
  }
  return notices.length > 0 ? <div className="space-y-3">{notices}</div> : null;
}

function LinesPanel({
  entry,
  accountsById,
  usd,
  totals,
}: {
  entry: JournalEntry;
  accountsById: ReturnType<typeof indexAccounts>;
  usd: (minor: number) => string;
  totals: ReturnType<typeof entryTotals>;
}) {
  const t = useTranslations('accounting.journalDetail');
  const locale = useLocale() as 'en';
  const money = (value: string) => (Number(value) === 0 ? '' : (formatMoney(value, entry.currencyCode, locale) ?? value));

  if (entry.lines.length === 0) {
    return (
      <RecordPanel title={t('linesHeading')}>
        <p className="text-body-sm text-muted-foreground">{t('noLines')}</p>
      </RecordPanel>
    );
  }
  return (
    <RecordPanel title={t('linesHeading')} padded={false}>
      <ul className="divide-y divide-border sm:hidden" aria-label={t('linesHeading')}>
        {entry.lines.map((line) => (
          <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3 text-body-sm">
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{lineAccountLabel(line, accountsById, locale)}</span>
              {line.description ? <span className="block text-caption text-muted-foreground">{line.description}</span> : null}
            </span>
            <span className="shrink-0 text-end tabular-nums">
              {Number(line.debitAmount) > 0 ? (
                <span className="block">{t('dr')} {money(line.debitAmount)}</span>
              ) : (
                <span className="block text-muted-foreground">{t('cr')} {money(line.creditAmount)}</span>
              )}
            </span>
          </li>
        ))}
        <li className="flex justify-between px-4 py-3 text-body-sm font-semibold">
          <span>{t('totals')}</span>
          <span className="tabular-nums">{usd(totals.debitMinor)}</span>
        </li>
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[560px] text-body-sm">
          <caption className="sr-only">{t('linesHeading')}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('colAccount')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('colMemo')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('colDebit')}</th>
              <th scope="col" className="px-4 py-2 text-end font-medium">{t('colCredit')}</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((line) => (
              <tr key={line.id} className="border-b border-border">
                <th scope="row" className="px-4 py-2.5 text-start font-normal text-foreground">{lineAccountLabel(line, accountsById, locale)}</th>
                <td className="px-3 py-2.5 text-muted-foreground">{line.description ?? ''}</td>
                <td className="px-3 py-2.5 text-end tabular-nums">{money(line.debitAmount)}</td>
                <td className="px-4 py-2.5 text-end tabular-nums">{money(line.creditAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" colSpan={2} className="px-4 py-2.5 text-start">{t('totals')}</th>
              <td className="px-3 py-2.5 text-end tabular-nums">{usd(totals.debitMinor)}</td>
              <td className="px-4 py-2.5 text-end tabular-nums">{usd(totals.creditMinor)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </RecordPanel>
  );
}

/** Reverse on a chosen day — not before the journal — with the reason on record. */
function ReverseDialog({
  entry,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: {
  entry: JournalEntry;
  isPending: boolean;
  errorMessage?: string;
  onConfirm: (reversalDate: string, reason: string) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('accounting.journalDetail');
  const tCommon = useTranslations('common');
  const journalDay = entry.accountingDate.slice(0, 10);
  const today = todayWireDate();
  const [date, setDate] = useState(today < journalDay ? journalDay : today);
  const [reason, setReason] = useState('');
  const tooEarly = date !== '' && date < journalDay;
  const ready = date !== '' && !tooEarly && reason.trim() !== '';

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      title={t('confirm.reverseTitle')}
      subtitle={t('confirm.reverseBody')}
      size="md"
      dirty={reason !== ''}
      busy={isPending}
      closeLabel={tCommon('close')}
      onSubmit={() => {
        if (ready) onConfirm(date, reason.trim());
      }}
    >
      <FormDialogBody className="space-y-4">
        {errorMessage ? <Alert variant="error" messages={[errorMessage]} /> : null}
        <FormField htmlFor="reverse-date" label={t('confirm.reverseDateLabel')} error={tooEarly ? t('confirm.reverseTooEarly') : undefined} required>
          <DatePicker id="reverse-date" value={date} onChange={setDate} />
        </FormField>
        <FormField htmlFor="reverse-reason" label={t('confirm.reverseReasonLabel')} required>
          <Input id="reverse-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>{tCommon('cancel')}</Button>
        </FormDialogClose>
        <Button type="submit" disabled={!ready} loading={isPending}>{t('actions.reverse')}</Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
