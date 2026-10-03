'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Briefcase } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  FINANCE_PORTFOLIO_QUEUES,
  type FinancePortfolioQueue,
  type FinancePortfolioResponse,
  type FinancePortfolioRow,
} from '@erp/types';
import { ContextBar, EmptyState, MoneyDisplay, Skeleton, StatusPill, ViewSwitcher, cn } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { statusTone } from '@/lib/status-registry';
import { downloadXlsx } from '@/lib/xlsx-export';

import { portfolioExportTable } from '../exports';
import { useCanViewFinanceProjects, useFinancePortfolio } from '../hooks';
import { ExportButtons } from './export-buttons';
import { NoFinanceAccess } from './no-finance-access';

type QueueView = 'ALL' | FinancePortfolioQueue;

/** The `?queue=` value, or ALL for anything else. */
export function parseQueue(value: string | null | undefined): QueueView {
  return FINANCE_PORTFOLIO_QUEUES.includes(value as FinancePortfolioQueue) ? (value as FinancePortfolioQueue) : 'ALL';
}

export const financeProjectHref = (projectId: string) => `/finance/projects/${projectId}`;

/**
 * Finance → Projects (ADR-043): every project the finance team looks after, with the morning
 * queues — To bill, Overdue, To pay — as one switch. Figures come from `GET /finance/projects`,
 * which reuses the per-project definitions; nothing is computed here. A row opens the project's
 * Finance workspace.
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

  const data = current.data;
  const moneyVisible = data?.moneyVisible ?? true;
  const money = (value: string | null, danger = false) => (
    <MoneyDisplay
      value={value}
      hidden={!moneyVisible}
      hiddenLabel={t('hidden')}
      className={cn(danger && value !== null && Number(value) > 0 && 'text-danger')}
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
    moneyColumn('billed', t('col.billed'), (r) => r.billed),
    moneyColumn('collected', t('col.collected'), (r) => r.collected),
    { ...moneyColumn('outstanding', t('col.outstanding'), (r) => r.outstanding), card: 'amount' },
    moneyColumn('overdue', t('col.overdue'), (r) => r.overdue, true),
    moneyColumn('costToDate', t('col.cost'), (r) => r.costToDate),
    {
      key: 'margin',
      header: t('col.margin'),
      numeric: true,
      sortable: true,
      redacted: data ? !data.marginVisible : false,
      plainValue: (row) => row.margin,
      render: (row) =>
        row.margin === null ? (
          <span className="text-muted-foreground" title={t('marginUnavailable')}>
            —
          </span>
        ) : (
          <span className={cn('tabular-nums', row.margin < 0 && 'text-danger')}>{t('percent', { value: row.margin })}</span>
        ),
    },
    {
      key: 'actions',
      header: t('col.needsAction'),
      card: 'status',
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
      plainValue: (row) => (pick(row) === null ? null : Number(pick(row))),
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
    <div className="space-y-4">
      <TotalsBar data={all.data} />

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        data={data?.items ?? []}
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
        defaultSort={{ key: 'project', direction: 'asc' }}
        searchPlaceholder={t('searchPlaceholder')}
        searchLabel={tGrid('searchLabel')}
      />
    </div>
  );
}

/**
 * The portfolio's totals, from the unfiltered read — one line per currency. Money in different
 * currencies is never added together.
 */
function TotalsBar({ data }: { data: FinancePortfolioResponse | undefined }) {
  const t = useTranslations('finance.projects');
  if (!data) return <Skeleton className="h-20 w-full rounded-panel" />;
  const hidden = !data.moneyVisible;
  const money = (value: string | null) => <MoneyDisplay value={value} hidden={hidden} hiddenLabel={t('hidden')} />;
  return (
    <div className="space-y-2" aria-label={t('totals.label')} role="group">
      {data.totals.map((totals) => (
        <ContextBar
          key={totals.currency ?? 'none'}
          headingId={`finance-projects-totals-${totals.currency ?? 'none'}`}
          title={t('totals.title', {
            currency: totals.currency ?? t('totals.noCurrency'),
            count: totals.projectCount,
          })}
          metrics={[
            { key: 'contract', label: t('totals.contract'), value: money(totals.contractValue) },
            { key: 'billed', label: t('totals.billed'), value: money(totals.billed) },
            { key: 'collected', label: t('totals.collected'), value: money(totals.collected) },
            { key: 'outstanding', label: t('totals.outstanding'), value: money(totals.outstanding) },
            { key: 'overdue', label: t('totals.overdue'), value: money(totals.overdue) },
            { key: 'toPay', label: t('totals.toPay'), value: money(totals.billsToPay.amount) },
          ]}
        />
      ))}
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
