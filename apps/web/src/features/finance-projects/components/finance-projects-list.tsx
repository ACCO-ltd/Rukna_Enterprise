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
import { ContextBar, EmptyState, MoneyDisplay, StatusPill, ViewSwitcher, cn } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { statusTone } from '@/lib/status-registry';

import { useCanViewFinanceProjects, useFinancePortfolio } from '../hooks';
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

  const counts = all.data?.queueCounts;
  const chipLabel = (key: QueueView) =>
    counts ? t('queue.withCount', { label: t(`queue.${key}`), count: counts[key] }) : t(`queue.${key}`);

  return (
    <div className="space-y-4">
      <TotalsBar data={all.data} />

      <ViewSwitcher
        aria-label={t('queue.label')}
        value={queue}
        onValueChange={setQueue}
        items={(['ALL', ...FINANCE_PORTFOLIO_QUEUES] as QueueView[]).map((key) => ({ value: key, label: chipLabel(key) }))}
      />

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

/** The portfolio's totals, from the unfiltered read. Mixed currencies are flagged, not converted. */
function TotalsBar({ data }: { data: FinancePortfolioResponse | undefined }) {
  const t = useTranslations('finance.projects');
  const totals = data?.totals;
  const hidden = data ? !data.moneyVisible : false;
  const money = (value: string | null | undefined) => (
    <MoneyDisplay value={value ?? null} hidden={hidden} hiddenLabel={t('hidden')} loading={!data} />
  );
  return (
    <ContextBar
      headingId="finance-projects-totals"
      title={t('totals.title', { count: data?.items.length ?? 0 })}
      metrics={[
        { key: 'contract', label: t('totals.contract'), value: money(totals?.contractValue) },
        { key: 'billed', label: t('totals.billed'), value: money(totals?.billed) },
        { key: 'collected', label: t('totals.collected'), value: money(totals?.collected) },
        { key: 'outstanding', label: t('totals.outstanding'), value: money(totals?.outstanding) },
        { key: 'overdue', label: t('totals.overdue'), value: money(totals?.overdue) },
        { key: 'toPay', label: t('totals.toPay'), value: money(totals?.billsToPay.amount) },
      ]}
      note={totals?.mixedCurrencies ? t('totals.mixedCurrencies') : undefined}
      noteTone={totals?.mixedCurrencies ? 'attention' : undefined}
    />
  );
}

/** What the project needs from finance today, as state pills — never a bare number. */
function NeedsAction({ row }: { row: FinancePortfolioRow }) {
  const t = useTranslations('finance.projects.needs');
  const pills: React.ReactNode[] = [];
  if (row.overdueInvoices.count > 0) {
    pills.push(
      <StatusPill key="overdue" tone="danger">
        {row.overdueInvoices.oldestDaysPastDue !== null
          ? t('overdueAged', { count: row.overdueInvoices.count, days: row.overdueInvoices.oldestDaysPastDue })
          : t('overdue', { count: row.overdueInvoices.count })}
      </StatusPill>,
    );
  }
  if (row.readyToBill.count > 0) {
    pills.push(
      <StatusPill key="bill" tone="attention">
        {t('toBill', { count: row.readyToBill.count })}
      </StatusPill>,
    );
  }
  if (row.billsToPay.count > 0) {
    pills.push(
      <StatusPill key="pay" tone="progress">
        {t('toPay', { count: row.billsToPay.count })}
      </StatusPill>,
    );
  }
  if (pills.length === 0) return <span className="text-caption text-muted-foreground">{t('none')}</span>;
  return <span className="flex flex-wrap items-start gap-1">{pills}</span>;
}
