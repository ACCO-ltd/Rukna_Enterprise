'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';

import { indexAccounts, lineAccountLabel } from '../account-display';
import { useAccounts, useJournal, useJournalAction } from '../hooks/use-accounting';
import { availableActions, entryTotals, formatDifference } from '../journal-entry';
import type { JournalAction } from '../journal-entry';
import { JournalStatusBadge } from './journal-status-badge';

/** Actions that take a free-text reason the server requires. */
const REASON_REQUIRED: Partial<Record<JournalAction, true>> = { reject: true, reverse: true };

export function JournalDetail({ journalId }: { journalId: string }) {
  const t = useTranslations('accounting.journalDetail');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const journal = useJournal(journalId);
  // Needed to name the accounts on a DRAFT, whose line snapshots are empty strings until the
  // posting engine fills them. Not blocking: a line falls back to its id tail.
  const accounts = useAccounts();
  const action = useJournalAction(journalId);

  const [pending, setPending] = useState<JournalAction | null>(null);

  const accountsById = useMemo(() => indexAccounts(accounts.data ?? []), [accounts.data]);

  if (journal.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

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

  const entry = journal.data;
  const totals = entryTotals(entry);
  const actions = availableActions(entry.status);

  function runAction(type: JournalAction, reason: string) {
    switch (type) {
      case 'submit':
        return action.mutate({ type: 'submit' }, { onSuccess: () => setPending(null) });
      case 'approve':
        return action.mutate(
          { type: 'approve', payload: { approved: true } },
          { onSuccess: () => setPending(null) },
        );
      case 'reject':
        return action.mutate(
          { type: 'approve', payload: { approved: false, rejectionReason: reason } },
          { onSuccess: () => setPending(null) },
        );
      case 'post':
        return action.mutate({ type: 'post' }, { onSuccess: () => setPending(null) });
      case 'reverse':
        return action.mutate(
          {
            type: 'reverse',
            payload: { reversalDate: new Date().toISOString().slice(0, 10), reason },
          },
          { onSuccess: () => setPending(null) },
        );
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/finance/accounting/journals"
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {entry.journalNumber ?? entry.id.slice(-8)}
          </span>
          <JournalStatusBadge status={entry.status} />
        </div>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          <bdi>
            {formatMoney(
              fromMinorUnits(totals.debitMinor, MONEY_SCALE),
              entry.currencyCode,
              locale,
            )}
          </bdi>
        </h1>
        <p className="text-sm text-muted-foreground">{entry.description}</p>
      </div>

      {/* A saved journal can be unbalanced: nothing is checked until posting. This is the one
          screen where a reviewer can see it before approving, so it is stated here rather
          than left for the post action to fail on. */}
      {!totals.balanced && entry.status !== 'REVERSED' ? (
        <Alert
          variant="warning"
          messages={[
            t('outOfBalanceWarning', {
              debit:
                formatMoney(
                  fromMinorUnits(totals.debitMinor, MONEY_SCALE),
                  entry.currencyCode,
                  locale,
                ) ?? '',
              credit:
                formatMoney(
                  fromMinorUnits(totals.creditMinor, MONEY_SCALE),
                  entry.currencyCode,
                  locale,
                ) ?? '',
            }),
          ]}
        />
      ) : null}

      {entry.rejectionReason ? (
        <Alert variant="warning" messages={[`${t('rejectionReason')}: ${entry.rejectionReason}`]} />
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t('accountingDate')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {formatDate(entry.accountingDate, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('documentDate')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {formatDate(entry.documentDate, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('currency')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">{entry.currencyCode}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('createdBy')}</dt>
            <dd className="mt-0.5 text-sm text-foreground">{entry.createdBy.slice(-8)}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t('linesHeading')}</h2>

        {entry.lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t('noLines')}</p>
          </div>
        ) : (
          <TableScroll aria-label={t('linesHeading')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">{t('colAccount')}</TableHead>
                  <TableHead className="min-w-[140px]">{t('colMemo')}</TableHead>
                  <TableHead numeric>{t('colDebit')}</TableHead>
                  <TableHead numeric>{t('colCredit')}</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {entry.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="min-w-[200px]">
                      <span className="text-sm text-foreground">
                        {lineAccountLabel(line, accountsById, locale)}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <span className="text-sm text-muted-foreground">
                        {line.description ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell numeric>
                      <bdi className="tabular-nums">
                        {formatMoney(line.debitAmount, entry.currencyCode, locale)}
                      </bdi>
                    </TableCell>
                    <TableCell numeric>
                      <bdi className="tabular-nums">
                        {formatMoney(line.creditAmount, entry.currencyCode, locale)}
                      </bdi>
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow>
                  <TableCell className="min-w-[200px]">
                    <span className="text-sm font-semibold text-foreground">{t('totals')}</span>
                  </TableCell>
                  <TableCell />
                  <TableCell numeric>
                    <bdi className="text-sm font-semibold tabular-nums">
                      {formatMoney(
                        fromMinorUnits(totals.debitMinor, MONEY_SCALE),
                        entry.currencyCode,
                        locale,
                      )}
                    </bdi>
                  </TableCell>
                  <TableCell numeric>
                    <bdi className="text-sm font-semibold tabular-nums">
                      {formatMoney(
                        fromMinorUnits(totals.creditMinor, MONEY_SCALE),
                        entry.currencyCode,
                        locale,
                      )}
                    </bdi>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">{t('actions.heading')}</h2>

        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('actions.noneAvailable')}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {actions.map((type) => (
              <Button
                key={type}
                variant={type === 'reject' || type === 'reverse' ? 'outline' : 'default'}
                // Posting an unbalanced journal is rejected by the server. Disabling here
                // means the reviewer sees why on the banner above rather than a 400.
                disabled={type === 'post' && !totals.balanced}
                onClick={() => setPending(type)}
              >
                {t(`actions.${type}`)}
              </Button>
            ))}
          </div>
        )}
      </section>

      {pending ? (
        <ConfirmActionDialog
          title={t(`confirm.${pending}Title`)}
          description={t(`confirm.${pending}Body`)}
          confirmLabel={t(`actions.${pending}`)}
          reason={
            REASON_REQUIRED[pending]
              ? {
                  required: true,
                  label:
                    pending === 'reject'
                      ? t('confirm.rejectReasonLabel')
                      : t('confirm.reverseReasonLabel'),
                  maxLength: 500,
                }
              : undefined
          }
          isPending={action.isPending}
          errorMessage={action.isError ? t('actions.failed') : undefined}
          onConfirm={(reason) => runAction(pending, reason)}
          onDismiss={() => {
            setPending(null);
            action.reset();
          }}
        />
      ) : null}

      {/* Rendered outside the dialog too: an action can fail after the dialog closes. */}
      {action.isError && !pending ? (
        <Alert variant="error" messages={[t('actions.failed')]} />
      ) : null}

      <p className="sr-only" aria-live="polite">
        {action.isPending ? t('actions.working') : ''}
      </p>

      {!totals.balanced ? (
        <p className="text-xs text-muted-foreground">
          {formatDifference(totals.differenceMinor)}
        </p>
      ) : null}
    </div>
  );
}
