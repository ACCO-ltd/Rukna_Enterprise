'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  ViewSwitcher,
  cn,
} from '@erp/ui';
import type {
  ProfitLoss,
  ProfitLossLine,
  ProfitLossSection,
} from '@/features/accounting/types';

import { formatDate, formatMoney } from '@/lib/format';
import { useProject } from '@/features/projects/hooks/use-project';

import { useFinanceOverview, useProjectPl } from '../hooks/use-finance';
import {
  availablePresets,
  buildRange,
  startsInFuture,
  type FinancePeriodPreset,
  type FinanceRange,
} from '../finance-period';
import { UnavailableNotice } from './finance-primitives';
import { Meter, ShareBar, toSegments } from './share-bar';

/**
 * The project's income statement, from posted general-ledger entries.
 *
 * Laid out as a statement, not as a wall of KPI cards. An income statement is a form accountants
 * read by shape — revenue, cost of sales, gross profit, expenses, net — and turning it into
 * tiles destroys the one thing that makes it fast to check.
 *
 * **Project to date is the default range.** The old screen defaulted to 1 January of the current
 * calendar year, which silently truncated every multi-year job and presented the remainder as
 * "the project's P&L" — and calendar year is not even the accounting year, since the fiscal
 * calendar is configurable.
 */
export function ProfitLossView({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.profitLoss');
  const tc = useTranslations('finance.common');
  const locale = useLocale() as 'en' | 'ar';

  const project = useProject(projectId);
  const overview = useFinanceOverview(projectId);

  const context = React.useMemo(
    () => ({
      projectStartDate: project.data?.startDate ?? null,
      currentPeriodStart: null,
      currentPeriodEnd: overview.data?.period?.endDate ?? null,
      fiscalYearStart: null,
    }),
    [project.data?.startDate, overview.data?.period?.endDate],
  );

  // Null until the reader picks a range. The default is derived rather than stored, so it
  // re-anchors on its own the moment the project's start date arrives — no effect needed, and
  // no window in which the screen has already fetched against the fallback range.
  const [range, setRange] = React.useState<FinanceRange | null>(null);
  const effectiveRange = range ?? buildRange('PROJECT_TO_DATE', context);

  const report = useProjectPl(projectId, {
    fromDate: effectiveRange.fromDate,
    toDate: effectiveRange.toDate,
  });

  const accountingReady = overview.data?.accountingPosition.available ?? true;
  const presets = availablePresets(context);
  // A project whose start date is still in the future has nothing for a report to cover. Saying
  // "nothing has been posted" there is true but useless; it reads as a data problem.
  const notStarted = startsInFuture(project.data?.startDate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('basis')}</p>
        </div>
        <ViewSwitcher
          aria-label={t('periodLabel')}
          value={effectiveRange.preset}
          onValueChange={(next) =>
            setRange(buildRange(next as FinancePeriodPreset, context))
          }
          items={presets.map((preset) => ({
            value: preset,
            label: t(`presets.${preset}`),
          }))}
        />
      </div>

      {effectiveRange.preset === 'CUSTOM' ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <FormField htmlFor="pl-from" label={t('fromDate')} className="sm:w-56">
            <DatePicker
              id="pl-from"
              value={effectiveRange.fromDate}
              onChange={(value) => setRange({ ...effectiveRange, fromDate: value })}
            />
          </FormField>
          <FormField htmlFor="pl-to" label={t('toDate')} className="sm:w-56">
            <DatePicker
              id="pl-to"
              value={effectiveRange.toDate}
              onChange={(value) => setRange({ ...effectiveRange, toDate: value })}
            />
          </FormField>
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">
          {t('rangeNote', {
            from: formatDate(effectiveRange.fromDate, locale) ?? effectiveRange.fromDate,
            to: formatDate(effectiveRange.toDate, locale) ?? effectiveRange.toDate,
          })}
        </p>
      )}

      {/* Two different states, and they must not look alike: the ledger cannot accept a posting
          at all, versus it can and this project has none in range. */}
      {notStarted ? (
        <UnavailableNotice title={tc('notStartedTitle')} reason={tc('notStartedReason')} />
      ) : !accountingReady ? (
        <UnavailableNotice
          title={t('unavailableTitle')}
          reason={t('unavailableReason')}
          items={(overview.data?.accountingPosition.blockers ?? []).map((b) => ({
            label: b.label,
            detail: b.detail,
          }))}
        />
      ) : report.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : report.isError ? (
        <Alert variant="error" title={tc('loadFailed')} messages={[tc('loadFailedHint')]}>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => report.refetch()}>
            {tc('retry')}
          </Button>
        </Alert>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Statement report={report.data} locale={locale} />
          <ProfitCharts report={report.data} />
        </div>
      )}
    </div>
  );
}

/**
 * Two pictures of the statement beside it, never instead of it.
 *
 * The statement is the artefact an accountant checks; these answer the two questions a reader
 * asks of it at a glance — how much of the revenue the project spent, and what it spent it on.
 * Every value in both is also a line in the statement, so nothing here is a figure that exists
 * only as a picture.
 */
function ProfitCharts({ report }: { report: ProfitLoss }) {
  const t = useTranslations('finance.profitLoss');
  const tc = useTranslations('finance.common');

  const revenue = Number(report.revenue.total);
  const totalCost = Number(report.costOfSales.total) + Number(report.expenses.total);

  // Nothing to divide, and nothing to consume: a chart of zero is a picture of nothing.
  if (revenue <= 0 && totalCost <= 0) return null;

  const costLines = [...report.costOfSales.lines, ...report.expenses.lines].map((line) => ({
    key: line.accountId,
    label: line.accountName,
    amount: line.amount,
  }));

  return (
    <div className="min-w-0 space-y-6">
      <div className="overflow-hidden rounded-panel border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5 sm:px-5">
            <h3 className="text-h3 font-semibold text-foreground">{t('charts.consumed')}</h3>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('charts.consumedHint')}
            </p>
          </div>
          <Meter
            ratioLabel={t('charts.ratio')}
            limitLabel={t('charts.revenuePosted')}
            limit={report.revenue.total}
            fillLabel={t('charts.costPosted')}
            fill={totalCost.toFixed(2)}
            remainderLabel={t('netIncome')}
            remainderNegativeLabel={t('netLoss')}
            noLimitLabel={t('charts.noRevenue')}
            emptyLabel={t('charts.noActivity')}
            currency="USD"
          />
      </div>

      {costLines.length > 0 ? (
        <div className="overflow-hidden rounded-panel border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5 sm:px-5">
            <h3 className="text-h3 font-semibold text-foreground">{t('charts.breakdown')}</h3>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('charts.breakdownHint')}
            </p>
          </div>
          <ShareBar
            title={t('charts.breakdown')}
            totalLabel={t('charts.totalCost')}
            total={totalCost.toFixed(2)}
            currency="USD"
            segments={toSegments(costLines, tc('other'))}
          />
        </div>
      ) : null}
    </div>
  );
}

function Statement({ report, locale }: { report: ProfitLoss; locale: 'en' | 'ar' }) {
  const t = useTranslations('finance.profitLoss');
  const [showCodes, setShowCodes] = React.useState(false);

  const empty =
    report.revenue.lines.length === 0 &&
    report.costOfSales.lines.length === 0 &&
    report.expenses.lines.length === 0;

  if (empty) {
    return (
      <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-body-sm font-medium text-foreground">{t('empty')}</p>
        <p className="mx-auto mt-1 max-w-prose text-caption text-muted-foreground">
          {t('emptyHint')}
        </p>
      </div>
    );
  }

  const money = (amount: string) => formatMoney(amount, 'USD', locale) ?? amount;
  const grossMarginPercent =
    Number(report.revenue.total) > 0
      ? ((Number(report.grossProfit) / Number(report.revenue.total)) * 100).toFixed(1)
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-muted-foreground">
          {t('generatedAt', {
            timestamp: formatDate(report.generatedAt, locale) ?? report.generatedAt,
          })}
          {' · '}
          {t('closingExcluded')}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setShowCodes((prev) => !prev)}>
          {showCodes ? t('hideCodes') : t('showCodes')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-panel border border-border bg-surface">
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('account')}</TableHead>
                <TableHead className="text-end">{t('amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SectionRows
                section={report.revenue}
                label={t('revenue')}
                showCodes={showCodes}
                money={money}
              />
              <SectionRows
                section={report.costOfSales}
                label={t('costOfSales')}
                showCodes={showCodes}
                money={money}
              />
              <SubtotalRow
                label={t('grossProfit')}
                amount={money(report.grossProfit)}
                note={
                  grossMarginPercent === null
                    ? null
                    : t('grossMargin', { percent: grossMarginPercent })
                }
              />
              <SectionRows
                section={report.expenses}
                label={t('expenses')}
                showCodes={showCodes}
                money={money}
              />
              <SubtotalRow
                label={Number(report.netIncome) < 0 ? t('netLoss') : t('netIncome')}
                amount={money(report.netIncome)}
                emphasis
              />
            </TableBody>
          </Table>
        </TableScroll>
      </div>

      <p className="max-w-prose text-caption text-muted-foreground">{t('managementNote')}</p>
    </div>
  );
}

/** One statement section: its heading, its account lines, and its total. */
function SectionRows({
  section,
  label,
  showCodes,
  money,
}: {
  section: ProfitLossSection;
  label: string;
  showCodes: boolean;
  money: (amount: string) => string;
}) {
  const t = useTranslations('finance.profitLoss');
  return (
    <>
      <TableRow className="bg-muted/40">
        <TableCell className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {label}
        </TableCell>
        <TableCell />
      </TableRow>
      {section.lines.length === 0 ? (
        <TableRow>
          <TableCell className="ps-8 text-body-sm text-muted-foreground">{t('noneInRange')}</TableCell>
          <TableCell />
        </TableRow>
      ) : (
        section.lines.map((line: ProfitLossLine) => (
          <TableRow key={line.accountId}>
            <TableCell className="ps-8 text-body-sm text-foreground">
              {showCodes ? (
                <span className="me-2 font-mono text-caption text-muted-foreground">
                  {line.accountCode}
                </span>
              ) : null}
              {line.accountName}
            </TableCell>
            <TableCell className="text-end tabular-nums text-foreground">
              {money(line.amount)}
            </TableCell>
          </TableRow>
        ))
      )}
      <TableRow>
        <TableCell className="ps-8 text-body-sm font-medium text-foreground">
          {t('total', { section: label })}
        </TableCell>
        <TableCell className="border-t border-border text-end font-medium tabular-nums text-foreground">
          {money(section.total)}
        </TableCell>
      </TableRow>
    </>
  );
}

/**
 * A subtotal line.
 *
 * Money stays neutral. A profit is not "good" and a loss is not "bad" — they are facts, and
 * colouring them teaches people to read the colour instead of the number. Only a negative net
 * result is marked, and by the label ("Net loss"), not by the hue alone.
 */
function SubtotalRow({
  label,
  amount,
  note,
  emphasis = false,
}: {
  label: string;
  amount: string;
  note?: string | null;
  emphasis?: boolean;
}) {
  return (
    <TableRow className={cn(emphasis ? 'bg-muted/60' : 'bg-muted/30')}>
      <TableCell
        className={cn(
          'text-body-sm text-foreground',
          emphasis ? 'font-semibold' : 'font-medium',
        )}
      >
        {label}
        {note ? <span className="ms-2 text-caption text-muted-foreground">{note}</span> : null}
      </TableCell>
      <TableCell
        className={cn(
          'text-end tabular-nums text-foreground',
          emphasis ? 'font-semibold' : 'font-medium',
        )}
      >
        {amount}
      </TableCell>
    </TableRow>
  );
}
