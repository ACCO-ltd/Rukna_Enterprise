'use client';

import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
} from '@erp/ui';
import type { ProjectLedgerLine, ProjectLedgerResponse } from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';
import { useProject } from '@/features/projects/hooks/use-project';

import { useFinanceOverview, useProjectLedger } from '../hooks/use-finance';
import { buildRange, startsInFuture } from '../finance-period';
import { UnavailableNotice } from './finance-primitives';

const PAGE_SIZE = 25;

/**
 * The postings behind the project's figures.
 *
 * A drill-down, not an authoring surface — journals are created in Accounting, and putting a
 * "new journal" button on a project screen would be a second way to post into the ledger.
 *
 * There is no running-balance column. Down one account a running balance accumulates to
 * something a person can check; down a project the rows are revenue, cost, receivables and cash
 * interleaved, and a figure that adds a revenue credit to a cost debit is not a balance anyone
 * can reconcile. The header totals come from the server over the whole filtered set instead —
 * summing the visible page and calling it a total would be wrong on page two.
 */
export function LedgerView({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.ledger');
  const tc = useTranslations('finance.common');
  const locale = useLocale() as 'en' | 'ar';

  const project = useProject(projectId);
  const overview = useFinanceOverview(projectId);

  const defaults = React.useMemo(
    () => buildRange('PROJECT_TO_DATE', { projectStartDate: project.data?.startDate ?? null }),
    [project.data?.startDate],
  );

  const [fromDate, setFromDate] = React.useState<string | null>(null);
  const [toDate, setToDate] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<ProjectLedgerLine | null>(null);

  const query = useProjectLedger(projectId, {
    fromDate: fromDate ?? defaults.fromDate,
    toDate: toDate ?? defaults.toDate,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const accountingReady = overview.data?.accountingPosition.available ?? true;

  if (startsInFuture(project.data?.startDate)) {
    return <UnavailableNotice title={tc('notStartedTitle')} reason={tc('notStartedReason')} />;
  }

  if (!accountingReady) {
    return (
      <UnavailableNotice
        title={t('unavailableTitle')}
        reason={t('unavailableReason')}
        items={(overview.data?.accountingPosition.blockers ?? []).map((b) => ({
          label: b.label,
          detail: b.detail,
        }))}
      />
    );
  }

  if (query.isPending) return <Skeleton className="h-[32rem] w-full" />;
  if (query.isError) {
    return (
      <Alert variant="error" title={tc('loadFailed')} messages={[tc('loadFailedHint')]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {tc('retry')}
        </Button>
      </Alert>
    );
  }

  const data = query.data;
  // Search narrows the loaded page only, and the count below says so rather than implying the
  // filter reached the server.
  const rows = search.trim()
    ? data.lines.filter((line) =>
        `${line.description} ${line.lineDescription ?? ''} ${line.accountName} ${line.journalNumber ?? ''} ${line.accountCode}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
    : data.lines;

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const money = (amount: string) => formatMoney(amount, 'USD', locale) ?? amount;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('basis')}</p>
      </div>

      <TotalsStrip data={data} money={money} />

      <div className="flex flex-wrap items-end gap-3">
        <FormField htmlFor="lg-from" label={t('fromDate')} className="w-full sm:w-48">
          <DatePicker
            id="lg-from"
            value={fromDate ?? defaults.fromDate}
            onChange={(value) => {
              setFromDate(value);
              setPage(0);
            }}
          />
        </FormField>
        <FormField htmlFor="lg-to" label={t('toDate')} className="w-full sm:w-48">
          <DatePicker
            id="lg-to"
            value={toDate ?? defaults.toDate}
            onChange={(value) => {
              setToDate(value);
              setPage(0);
            }}
          />
        </FormField>
        <FormField htmlFor="lg-search" label={t('search')} className="w-full sm:w-64">
          <Input
            id="lg-search"
            value={search}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </FormField>
        {fromDate || toDate || search ? (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={() => {
              setFromDate(null);
              setToDate(null);
              setSearch('');
              setPage(0);
            }}
          >
            {t('reset')}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col.date')}</TableHead>
                  <TableHead>{t('col.journal')}</TableHead>
                  <TableHead>{t('col.account')}</TableHead>
                  <TableHead>{t('col.description')}</TableHead>
                  <TableHead className="text-end">{t('col.debit')}</TableHead>
                  <TableHead className="text-end">{t('col.credit')}</TableHead>
                  <TableHead>{t('col.source')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-body-sm text-muted-foreground">
                      {search.trim() ? t('noMatches') : t('empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((line, index) => (
                    <TableRow
                      key={`${line.journalEntryId}-${line.accountId}-${index}`}
                      onClick={() => setSelected(line)}
                      className={cn(
                        'cursor-pointer',
                        selected?.journalEntryId === line.journalEntryId && 'bg-muted/50',
                      )}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(line.accountingDate, locale) ?? line.accountingDate}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-caption text-foreground">
                        {line.journalNumber ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-foreground">
                        <span className="font-mono text-caption text-muted-foreground">
                          {line.accountCode}
                        </span>{' '}
                        {line.accountName}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {line.lineDescription ?? line.description}
                      </TableCell>
                      {/* An em dash on the empty side, not $0.00 — it makes a ledger scannable. */}
                      <TableCell className="text-end tabular-nums text-foreground">
                        {Number(line.debitAmount) === 0 ? '—' : money(line.debitAmount)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-foreground">
                        {Number(line.creditAmount) === 0 ? '—' : money(line.creditAmount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {line.sourceDocumentType
                          ? t(`source.${line.sourceDocumentType}`, {
                              fallback: line.sourceDocumentType,
                            })
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableScroll>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
            <p className="text-caption text-muted-foreground">
              {search.trim()
                ? t('showingFiltered', { shown: rows.length, page: data.lines.length })
                : t('showing', {
                    from: data.total === 0 ? 0 : page * PAGE_SIZE + 1,
                    to: Math.min((page + 1) * PAGE_SIZE, data.total),
                    total: data.total,
                  })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t('previous')}
              </Button>
              <span className="text-caption text-muted-foreground">
                {t('pageOf', { page: page + 1, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        </div>

        {selected ? (
          <EntryDetail line={selected} locale={locale} money={money} onClose={() => setSelected(null)} />
        ) : (
          <aside className="hidden rounded-panel border border-dashed border-border bg-surface px-5 py-6 xl:block">
            <p className="text-body-sm text-muted-foreground">{t('selectHint')}</p>
          </aside>
        )}
      </div>
    </div>
  );
}

/** Server-computed totals over the whole filtered set — never a sum of the visible page. */
function TotalsStrip({
  data,
  money,
}: {
  data: ProjectLedgerResponse;
  money: (amount: string) => string;
}) {
  const t = useTranslations('finance.ledger');
  return (
    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
      {[
        { label: t('totals.revenue'), value: money(data.totalRevenue) },
        { label: t('totals.cost'), value: money(data.totalCost) },
        { label: t('totals.entries'), value: String(data.total) },
      ].map((item) => (
        <div key={item.label} className="bg-surface px-4 py-3">
          <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 text-h3 font-bold tabular-nums text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One posting, with its attribution.
 *
 * Dimensions that are absent are omitted rather than rendered as a column of em dashes: a bill
 * for project-level cost genuinely has no BOQ item, and showing an empty row for it implies
 * somebody failed to fill it in.
 */
function EntryDetail({
  line,
  locale,
  money,
  onClose,
}: {
  line: ProjectLedgerLine;
  locale: 'en' | 'ar';
  money: (amount: string) => string;
  onClose: () => void;
}) {
  const t = useTranslations('finance.ledger');

  const facts: Array<{ label: string; value: string }> = [
    { label: t('detail.journal'), value: line.journalNumber ?? '—' },
    {
      label: t('detail.accountingDate'),
      value: formatDate(line.accountingDate, locale) ?? line.accountingDate,
    },
    {
      label: t('detail.documentDate'),
      value: formatDate(line.documentDate, locale) ?? line.documentDate,
    },
    { label: t('detail.account'), value: `${line.accountCode} · ${line.accountName}` },
    { label: t('detail.purpose'), value: line.entryPurpose },
  ];

  const attribution: Array<{ label: string; value: string }> = [];
  if (line.boqNodeId) attribution.push({ label: t('detail.boqItem'), value: line.boqNodeId });
  if (line.spendCategoryId)
    attribution.push({ label: t('detail.spendCategory'), value: line.spendCategoryId });
  if (line.contractId) attribution.push({ label: t('detail.contract'), value: line.contractId });

  // A link only where the route genuinely exists — a reference that goes nowhere teaches
  // people to stop following them.
  const sourceHref =
    line.sourceDocumentType === 'SUPPLIER_BILL' && line.sourceDocumentId
      ? `/finance/accounting/bills/${line.sourceDocumentId}`
      : line.sourceDocumentType === 'CLIENT_INVOICE' && line.sourceDocumentId
        ? `/finance/accounting/invoices/${line.sourceDocumentId}`
        : line.sourceDocumentType === 'MANUAL_JOURNAL'
          ? `/finance/accounting/journals/${line.journalEntryId}`
          : null;

  return (
    <aside className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-h3 font-semibold text-foreground">{t('detail.title')}</h3>
          <p className="mt-0.5 truncate text-caption text-muted-foreground">{line.description}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('detail.close')}
          className="inline-flex size-11 shrink-0 items-center justify-center -my-2 -me-2 text-muted-foreground hover:text-foreground"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-caption text-muted-foreground">
            {Number(line.debitAmount) === 0 ? t('col.credit') : t('col.debit')}
          </span>
          <span className="text-h3 font-bold tabular-nums text-foreground">
            {money(Number(line.debitAmount) === 0 ? line.creditAmount : line.debitAmount)}
          </span>
        </div>

        <dl className="space-y-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-caption text-muted-foreground">{fact.label}</dt>
              <dd className="text-body-sm text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>

        {attribution.length > 0 ? (
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t('detail.attribution')}
            </p>
            <dl className="space-y-2">
              {attribution.map((fact) => (
                <div key={fact.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-caption text-muted-foreground">{fact.label}</dt>
                  <dd className="truncate text-body-sm text-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {sourceHref ? (
          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link href={sourceHref}>{t('detail.openSource')}</Link>
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
