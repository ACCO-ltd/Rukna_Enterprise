'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Briefcase } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FINANCE_PORTFOLIO_QUEUES, type FinancePortfolioQueue, type FinancePortfolioRow } from '@erp/types';
import { EmptyState, Meter, MoneyDisplay, StatusPill, ViewSwitcher, cn } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { statusTone } from '@/lib/status-registry';
import { downloadXlsx } from '@/lib/xlsx-export';

import { portfolioExportTable } from '../exports';
import { useCanViewFinanceProjects, useFinancePortfolio } from '../hooks';
import { ExportButtons } from './export-buttons';
import { isPositive, minor, share } from '../figures';
import { financeProjectRedirects } from '../redirects';
import { PortfolioCharts, PortfolioTotals, QueueCards } from './finance-portfolio-summary';
import { NoFinanceAccess } from './no-finance-access';

type QueueView = 'ALL' | FinancePortfolioQueue;

/** The `?queue=` value, or ALL for anything else. */
export function parseQueue(value: string | null | undefined): QueueView {
  return FINANCE_PORTFOLIO_QUEUES.includes(value as FinancePortfolioQueue) ? (value as FinancePortfolioQueue) : 'ALL';
}

export const financeProjectHref = financeProjectRedirects.overview;

/** How urgent a row is for finance today: overdue money first, then billing, then paying, then nothing. */
export function needsPriority(row: FinancePortfolioRow): number {
  if (row.overdueInvoices.count > 0) return 3;
  if (row.readyToBill.count > 0) return 2;
  if (row.billsToPay.count > 0) return 1;
  return 0;
}

/**
 * Rows that need finance first (most urgent), then the rest. Within a level, rows are grouped by
 * currency before comparing outstanding — amounts in two currencies are never compared — then by
 * name.
 */
export function orderForFinance(rows: readonly FinancePortfolioRow[]): FinancePortfolioRow[] {
  return [...rows].sort(
    (a, b) =>
      needsPriority(b) - needsPriority(a) ||
      (a.currency ?? '\uffff').localeCompare(b.currency ?? '\uffff') ||
      minor(b.outstanding) - minor(a.outstanding) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Finance → Projects (ADR-043; landing redesign 2026-10-10): the portfolio a finance officer
 * starts the day on — the money per currency, the three morning queues (To bill, Overdue, To pay)
 * as cards with their largest projects, two charts, then a slim table with the projects that need
 * finance first. Figures come from `GET /finance/projects`, which reuses the per-project
 * definitions; only display shares are computed here. A row opens the project's Finance workspace;
 * the export keeps every column.
 */
export function FinanceProjectsList() {
  const t = useTranslations('finance.projects');
  const tGrid = useTranslations('common.grid');
  const tStatus = useTranslations('platform.projects.status');
  const tNeeds = useTranslations('finance.projects.needs');
  const router = useRouter();
  const pathname = usePathname() ?? '/finance/projects';
  const searchParams = useSearchParams();
  const queue = parseQueue(searchParams?.get('queue'));
  const allowed = useCanViewFinanceProjects();

  // Counts and totals for the chips come from the unfiltered read; the table from the queue's.
  const all = useFinancePortfolio({}, { enabled: allowed });
  const filtered = useFinancePortfolio(queue === 'ALL' ? {} : { queue }, { enabled: allowed && queue !== 'ALL' });
  const current = queue === 'ALL' ? all : filtered;

  if (!allowed) return <NoFinanceAccess />;

  const setQueue = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next === 'ALL') params.delete('queue');
    else params.set('queue', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  // A card's "Show all" filters the table and brings it into view.
  const showQueue = (next: FinancePortfolioQueue) => {
    setQueue(next);
    document.getElementById('finance-projects-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const data = current.data;
  const moneyVisible = data?.moneyVisible ?? true;
  const money = (value: string | null, danger = false) => (
    <MoneyDisplay
      value={value}
      hidden={!moneyVisible}
      hiddenLabel={t('hidden')}
      className={cn(danger && isPositive(value) && 'text-danger')}
    />
  );

  const columns: GridColumn<FinancePortfolioRow>[] = [
    {
      key: 'project',
      header: t('col.project'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (row) => `${row.code} ${row.name}`,
      render: (row) => (
        <span className="block">
          <span className="block max-w-[18rem] truncate font-semibold text-brand-primary">{row.name}</span>
          <span className="flex items-center gap-2 text-caption font-normal text-muted-foreground">
            <span className="tabular-nums">{row.code}</span>
            <StatusPill tone={statusTone(row.status, 'project')}>{tStatus(row.status)}</StatusPill>
          </span>
        </span>
      ),
    },
    {
      key: 'client',
      header: t('col.client'),
      sortable: true,
      card: 'subtitle',
      plainValue: (row) => row.clientName ?? '',
      render: (row) =>
        row.clientName ? (
          <span className="block max-w-[14rem] truncate">{row.clientName}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    moneyColumn('contractValue', t('col.contract'), (r) => r.contractValue),
    {
      key: 'billedShare',
      header: t('col.billedShare'),
      numeric: true,
      sortable: true,
      redacted: !moneyVisible,
      plainValue: (row) => share(row.billedExclTax, row.contractValue),
      render: (row) => {
        const percent = share(row.billedExclTax, row.contractValue);
        // No contract, no denominator: absent, never 0%.
        if (percent === null) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="inline-flex items-center justify-end gap-2">
            <Meter value={percent} label={t('billedShareLabel', { name: row.name })} />
            <span className="w-10 text-end tabular-nums">{t('percent', { value: percent })}</span>
          </span>
        );
      },
    },
    {
      key: 'outstanding',
      header: t('col.outstanding'),
      numeric: true,
      sortable: true,
      card: 'amount',
      redacted: !moneyVisible,
      plainValue: (row) => (row.outstanding === null ? null : minor(row.outstanding)),
      render: (row) => (
        <span className="block">
          <span className="block">{money(row.outstanding)}</span>
          {isPositive(row.overdue) ? (
            <span className="block text-caption text-danger">
              {t('overdueLabel')} <MoneyDisplay value={row.overdue} hidden={!moneyVisible} hiddenLabel={t('hidden')} />
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('col.needsAction'),
      card: 'status',
      sortable: true,
      // Sorting by need puts the most urgent first: overdue, then to bill, then to pay.
      plainValue: (row) => needsPriority(row),
      render: (row) => <NeedsAction row={row} />,
    },
  ];

  function moneyColumn(
    key: string,
    header: string,
    pick: (row: FinancePortfolioRow) => string | null,
    danger = false,
  ): GridColumn<FinancePortfolioRow> {
    return {
      key,
      header,
      numeric: true,
      sortable: true,
      redacted: !moneyVisible,
      plainValue: (row) => (pick(row) === null ? null : minor(pick(row))),
      render: (row) => money(pick(row), danger),
    };
  }

  // Export the rows of the current queue (the API's filter) with their per-currency totals — the
  // grid's columns, money as numbers. The grid's own text search is not applied to the file.
  const exportTable = () =>
    portfolioExportTable(data?.items ?? [], data?.totals ?? [], {
      headers: {
        code: t('export.code'),
        project: t('export.project'),
        status: t('export.status'),
        client: t('col.client'),
        currency: t('export.currency'),
        contract: t('col.contract'),
        billed: t('col.billed'),
        collected: t('col.collected'),
        outstanding: t('col.outstanding'),
        overdue: t('col.overdue'),
        cost: t('col.cost'),
        margin: t('col.margin'),
        needsAction: t('col.needsAction'),
      },
      status: (status) => tStatus(status),
      needsAction: (row) => needsActionLabels(row, tNeeds as unknown as NeedsTranslator).map((p) => p.label).join('; '),
      totalLabel: (currency) => t('export.total', { currency: currency ?? t('export.noCurrency') }),
    });
  const filename = reportFilename('finance-projects', queue === 'ALL' ? null : queue.toLowerCase(), data?.asOf.slice(0, 10));

  const counts = all.data?.queueCounts;
  const chipLabel = (key: QueueView) =>
    counts ? t('queue.withCount', { label: t(`queue.${key}`), count: counts[key] }) : t(`queue.${key}`);

  return (
    <div className="space-y-6">
      <PortfolioTotals data={all.data} />
      <QueueCards data={all.data} onShowAll={showQueue} />
      <PortfolioCharts data={all.data} />

      <div id="finance-projects-table" className="flex scroll-mt-4 flex-wrap items-center justify-between gap-3">
        <ViewSwitcher
          aria-label={t('queue.label')}
          value={queue}
          onValueChange={setQueue}
          items={(['ALL', ...FINANCE_PORTFOLIO_QUEUES] as QueueView[]).map((key) => ({ value: key, label: chipLabel(key) }))}
        />
        <ExportButtons
          disabled={!data || data.items.length === 0}
          onCsv={() => {
            const table = exportTable();
            exportCsv(filename, table.headers, table.rows);
          }}
          onXlsx={() => {
            const table = exportTable();
            downloadXlsx(filename, [{ name: t('title'), rows: [table.headers, ...table.rows] }]);
          }}
        />
      </div>

      <PlatformDataGrid
        columns={columns}
        data={orderForFinance(data?.items ?? [])}
        rowKey={(row) => row.projectId}
        label={t('title')}
        isLoading={current.isPending}
        isError={current.isError}
        onRetry={() => void current.refetch()}
        errorMessage={t('loadFailed')}
        rowHref={(row) => financeProjectHref(row.projectId)}
        emptyState={
          <EmptyState
            icon={<Briefcase size={20} aria-hidden="true" />}
            title={queue === 'ALL' ? t('empty') : t(`queueEmpty.${queue}`)}
            description={queue === 'ALL' ? t('emptyHint') : undefined}
          />
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        searchPlaceholder={t('searchPlaceholder')}
        searchLabel={tGrid('searchLabel')}
      />
    </div>
  );
}

type NeedsTranslator = (key: string, values?: Record<string, number>) => string;

/**
 * What the project needs from finance today, as labelled states — one list behind the pills and
 * the export's "Needs action" column.
 */
export function needsActionLabels(
  row: FinancePortfolioRow,
  t: NeedsTranslator,
): { key: string; tone: 'danger' | 'attention' | 'progress'; label: string }[] {
  const out: { key: string; tone: 'danger' | 'attention' | 'progress'; label: string }[] = [];
  if (row.overdueInvoices.count > 0) {
    out.push({
      key: 'overdue',
      tone: 'danger',
      label:
        row.overdueInvoices.oldestDaysPastDue !== null
          ? t('overdueAged', { count: row.overdueInvoices.count, days: row.overdueInvoices.oldestDaysPastDue })
          : t('overdue', { count: row.overdueInvoices.count }),
    });
  }
  // ADR-043 decision 1 — Finance issues invoices: a ready stage stays here until its invoice is
  // posted, split into "not prepared" (nothing raised yet) and "draft prepared" (awaiting issue).
  const notPrepared = row.readyToBill.count - row.readyToBill.draftCount;
  if (notPrepared > 0) out.push({ key: 'bill', tone: 'attention', label: t('toBill', { count: notPrepared }) });
  if (row.readyToBill.draftCount > 0) {
    out.push({ key: 'draft', tone: 'progress', label: t('draftPrepared', { count: row.readyToBill.draftCount }) });
  }
  if (row.billsToPay.count > 0) out.push({ key: 'pay', tone: 'progress', label: t('toPay', { count: row.billsToPay.count }) });
  return out;
}

/** What the project needs from finance today, as state pills — never a bare number. */
function NeedsAction({ row }: { row: FinancePortfolioRow }) {
  const t = useTranslations('finance.projects.needs');
  const pills = needsActionLabels(row, t as unknown as NeedsTranslator);
  if (pills.length === 0) return <span className="text-caption text-muted-foreground">{t('none')}</span>;
  return (
    <span className="flex flex-wrap items-start gap-1">
      {pills.map((p) => (
        <StatusPill key={p.key} tone={p.tone}>
          {p.label}
        </StatusPill>
      ))}
    </span>
  );
}
