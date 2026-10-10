'use client';

import Link from 'next/link';
import { ArrowRight, CalendarClock, ClipboardCheck, Scale, Settings2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  CashflowForecastResponse,
  CommercialPaymentScheduleInstallment,
  FinancePortfolioRow,
  ProjectFinanceOverviewResponse,
} from '@erp/types';
import {
  Alert,
  Button,
  MoneyDisplay,
  Panel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  StatusPill,
  type ActionListItem,
} from '@erp/ui';

import { MetricStrip, type Metric } from '@/components/widget/metric-strip';
import { BillingTodoCard, projectInvoiceHref } from '@/features/commercial/components/commercial-billing-view';
import { useCommercialCurrentCycle } from '@/features/commercial/hooks/use-commercial';
import { useCommercialWorkspace } from '@/features/commercial/hooks/use-commercial-workspace';
import { ControlRow, Money } from '@/features/finance/components/finance-primitives';
import { useFinanceOverview } from '@/features/finance/hooks/use-finance';
import { formatDate, formatMoney } from '@/lib/format';
import { statusTone } from '@/lib/status-registry';

import { useCanViewProjectPayables, useCashflowForecast, useFinanceProject } from '../hooks';
import { financeProjectRedirects } from '../redirects';
import { InOutBars, SegmentBar, ValueBar } from './finance-project-charts';

type Locale = 'en' | 'ar';

const num = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

/** A whole-number share, or null when there is no denominator — never a 0% that claims a fact. */
export function share(part: string | null, whole: string | null): number | null {
  const p = num(part);
  const w = num(whole);
  if (p === null || w === null || w <= 0) return null;
  return Math.round((p / w) * 100);
}

/**
 * The Finance project dashboard (ADR-043, Finance → Projects → Overview). It answers, in order:
 * where the money stands (five figures), what needs me (one list, with the command beside each
 * row), how billing is going (the payment schedule), what cash is coming and going, and whether
 * cost is inside budget — then whether the figures can be trusted, as one badge.
 *
 * Nothing is computed here but display ratios. Every figure is a read the project's own screens
 * already use: the portfolio row (`GET /finance/projects/:id`), the Finance Overview, the commercial
 * workspace + current cycle (the Billing tab's reads), and the cash-flow forecast. The Needs-action
 * list is the Billing tab's own To do card — the same rows, the same commands.
 */
export function FinanceProjectDashboard({ projectId }: { projectId: string }) {
  const project = useFinanceProject(projectId);
  const overview = useFinanceOverview(projectId);
  const row = project.data?.item;

  return (
    <div className="space-y-6" data-finance-dashboard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AsOf asOf={project.data?.asOf} />
        {overview.data ? <ControlsBadge data={overview.data} /> : null}
      </div>

      {row ? <KeyFigures row={row} moneyVisible={project.data!.moneyVisible} overview={overview.data} /> : <Skeleton className="h-24 w-full rounded-panel" />}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <BillingProgress projectId={projectId} />
        <NeedsAction projectId={projectId} row={row} overview={overview.data} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <CashFlow projectId={projectId} currency={row?.currency ?? null} />
        <CostVsBudget projectId={projectId} query={overview} />
      </div>

      <RecentActivity query={overview} />
    </div>
  );
}

function AsOf({ asOf }: { asOf: string | undefined }) {
  const t = useTranslations('finance.projects.dashboard');
  const locale = useLocale() as Locale;
  if (!asOf) return <span />;
  return <p className="text-caption text-muted-foreground">{t('asOf', { date: formatDate(asOf, locale) ?? asOf })}</p>;
}

function PanelError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('finance.projects.dashboard');
  return (
    <Alert variant="error" messages={[t('loadFailed')]}>
      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
        {t('retry')}
      </Button>
    </Alert>
  );
}

function OpenLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>
        {children}
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </Button>
  );
}

// ─── Can these figures be trusted ─────────────────────────────────────────────

/**
 * The five finance controls as one badge. Reconciled is the normal state and reads as a quiet
 * pill; a control that needs review turns it amber and says how many. The rows are one click away.
 */
function ControlsBadge({ data }: { data: ProjectFinanceOverviewResponse }) {
  const t = useTranslations('finance.projects.dashboard.controls');
  const tc = useTranslations('finance.overview.controls');
  const locale = useLocale() as Locale;
  const { controls, reconciliation, billingReconciliation, budget, period } = data;
  const review = Object.values(controls).filter((c) => c.state === 'ATTENTION').length;
  const info = data.attention.filter((item) => item.severity === 'INFO');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-caption font-medium text-foreground hover:bg-surface-subtle focus-visible:shadow-ring focus-visible:outline-none"
        >
          {review === 0 ? (
            <ShieldCheck size={15} className="text-success" aria-hidden="true" />
          ) : (
            <ShieldAlert size={15} className="text-warning" aria-hidden="true" />
          )}
          {review === 0 ? t('reconciled') : t('review', { count: review })}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <p className="border-b border-border px-4 py-3 text-body-sm font-semibold text-foreground">{t('title')}</p>
        <ControlRow
          icon={<Scale size={16} strokeWidth={1.9} />}
          label={tc('reconciliation')}
          status={controls.reconciliation}
          detail={tc('reconciliationDetail', { variance: reconciliation.variance })}
        />
        <ControlRow
          icon={<Scale size={16} strokeWidth={1.9} />}
          label={tc('billing')}
          status={controls.billing}
          detail={
            billingReconciliation.variance !== null
              ? tc('billingDetail', {
                  invoiced: formatMoney(billingReconciliation.invoicedNet, data.currency, locale) ?? '—',
                  revenue: formatMoney(billingReconciliation.glRevenue, data.currency, locale) ?? '—',
                })
              : undefined
          }
        />
        <ControlRow icon={<Settings2 size={16} strokeWidth={1.9} />} label={tc('accountingSetup')} status={controls.accountingSetup} />
        <ControlRow
          icon={<ClipboardCheck size={16} strokeWidth={1.9} />}
          label={tc('costBudget')}
          status={controls.costBudget}
          detail={
            budget.status === 'BASELINED' && budget.baselinedAt
              ? tc('budgetDetail', { version: budget.versionNumber ?? 0, date: formatDate(budget.baselinedAt, locale) ?? budget.baselinedAt })
              : undefined
          }
        />
        <ControlRow
          icon={<CalendarClock size={16} strokeWidth={1.9} />}
          label={tc('period')}
          status={controls.period}
          detail={period ? tc('periodDetail', { name: period.name, days: period.daysToPeriodEnd }) : undefined}
        />
        {info.length > 0 ? (
          <ul className="border-t border-border px-4 py-3 text-caption text-muted-foreground">
            {info.map((item) => (
              <li key={item.code}>
                <span className="font-medium text-foreground">{item.title}.</span> {item.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ─── Where the money stands ────────────────────────────────────────────────────

function KeyFigures({
  row,
  moneyVisible,
  overview,
}: {
  row: FinancePortfolioRow;
  moneyVisible: boolean;
  overview: ProjectFinanceOverviewResponse | undefined;
}) {
  const t = useTranslations('finance.projects.dashboard.figures');
  const locale = useLocale() as Locale;
  const currency = row.currency;
  const money = (value: string | null) => (moneyVisible && value !== null && currency ? formatMoney(value, currency, locale) : null);
  const restricted = moneyVisible ? undefined : t('restricted');

  const billedShare = share(row.billedExclTax, row.contractValue);
  const collectedShare = share(row.collected, row.billed);
  const overdue = num(row.overdue) ?? 0;
  const noCost = row.margin !== null && num(row.costToDate) === 0;

  const metrics: Metric[] = [
    {
      label: t('contract'),
      value: money(row.contractValue),
      sublabel: restricted ?? (row.contractValue === null ? t('noContract') : t('contractSub')),
    },
    {
      label: t('billed'),
      value: money(row.billedExclTax),
      sublabel: restricted ?? (billedShare === null ? t('nothingBilled') : t('ofContract', { percent: billedShare })),
    },
    {
      label: t('collected'),
      value: money(row.collected),
      sublabel: restricted ?? (collectedShare === null ? t('nothingToCollect') : t('ofBilled', { percent: collectedShare })),
    },
    {
      label: t('outstanding'),
      value: money(row.outstanding),
      ...(overdue > 0
        ? {
            sublabel: t('overdueSub', {
              amount: money(row.overdue) ?? '',
              days: row.overdueInvoices.oldestDaysPastDue ?? 0,
            }),
            sublabelTone: 'danger' as const,
          }
        : { sublabel: restricted ?? t('nothingOverdue') }),
    },
    {
      label: t('margin'),
      // "No cost yet" over a 100% that only says nothing has been coded.
      value: row.margin === null || noCost ? null : t('percent', { value: row.margin }),
      sublabel:
        row.margin === null
          ? t('marginUnavailable')
          : noCost
            ? t('noCostYet')
            : t('marginSub', {
                revenue: money(overview?.accountingPosition.revenue ?? null) ?? '—',
                cost: money(row.costToDate) ?? '—',
              }),
    },
  ];

  return <MetricStrip columns={5} labelStyle="sentence" aria-label={t('label')} metrics={metrics} />;
}

// ─── What needs me ───────────────────────────────────────────────────────────

function NeedsAction({
  projectId,
  row,
  overview,
}: {
  projectId: string;
  row: FinancePortfolioRow | undefined;
  overview: ProjectFinanceOverviewResponse | undefined;
}) {
  const t = useTranslations('finance.projects.dashboard.needs');
  const tSeverity = useTranslations('finance.overview.attention.severity');
  const workspace = useCommercialWorkspace(projectId);
  const canPayables = useCanViewProjectPayables();

  if (workspace.isPending) return <Skeleton className="h-64 w-full rounded-panel" />;
  if (workspace.isError || !workspace.data) return <PanelError onRetry={() => void workspace.refetch()} />;

  const extra: ActionListItem[] = [];
  if (row && row.billsToPay.count > 0) {
    extra.push({
      key: 'bills-to-pay',
      tone: 'progress',
      title: t('billsToPay', { count: row.billsToPay.count }),
      description: t('billsToPayHint'),
      amount: <MoneyDisplay value={row.billsToPay.amount} hidden={row.billsToPay.amount === null} hiddenLabel={t('restricted')} />,
      action: canPayables ? (
        <Button asChild size="sm" variant="outline">
          <Link href={financeProjectRedirects.transactions(projectId, 'bills')}>{t('reviewBills')}</Link>
        </Button>
      ) : null,
    });
  }
  // Finance controls that ask for work (unposted bills, a closing period, setup); "for info" rows
  // live behind the controls badge instead.
  for (const item of overview?.attention ?? []) {
    if (item.severity === 'INFO') continue;
    extra.push({
      key: `control-${item.code}`,
      tone: statusTone(item.severity, 'severity'),
      title: item.title,
      description: `${tSeverity(item.severity)} · ${item.detail}`,
      action: item.href ? (
        <Button asChild size="sm" variant="outline">
          <Link href={item.href}>{t('open')}</Link>
        </Button>
      ) : null,
    });
  }

  return (
    <BillingTodoCard
      projectId={projectId}
      workspace={workspace.data}
      invoiceHref={projectInvoiceHref(projectId)}
      extraItems={extra}
      title={(count) => t('title', { count })}
    />
  );
}

// ─── How billing is going ─────────────────────────────────────────────────────

const BILLED_STATES = new Set(['BILLED', 'PART_PAID', 'OVERDUE']);

/** A stage's money as three shares of its amount: collected, billed but unpaid, not yet billed. */
export function stageSegments(stage: Pick<CommercialPaymentScheduleInstallment, 'amount' | 'amountPaid' | 'collectionStatus'>) {
  const amount = num(stage.amount) ?? 0;
  if (amount <= 0) return { collected: 0, billedUnpaid: 0 };
  if (stage.collectionStatus === 'PAID') return { collected: 100, billedUnpaid: 0 };
  const collected = Math.min(100, ((num(stage.amountPaid) ?? 0) / amount) * 100);
  const billedUnpaid = BILLED_STATES.has(stage.collectionStatus) ? 100 - collected : 0;
  return { collected, billedUnpaid };
}

function BillingProgress({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.projects.dashboard.billing');
  const tCollection = useTranslations('commercial.contractView.collectionStatus');
  const locale = useLocale() as Locale;
  const cycle = useCommercialCurrentCycle(projectId);

  const action = <OpenLink href={`/finance/projects/${projectId}/billing`}>{t('open')}</OpenLink>;

  if (cycle.isPending) return <Skeleton className="h-64 w-full rounded-panel" />;
  if (cycle.isError) return <PanelError onRetry={() => void cycle.refetch()} />;

  const schedule = cycle.data.paymentSchedule;
  if (!schedule || schedule.installments.length === 0) {
    return (
      <Panel title={t('title')} action={action}>
        <p className="text-body-sm text-muted-foreground">{t('noSchedule')}</p>
      </Panel>
    );
  }

  const stages = [...schedule.installments].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Panel title={t('title')} sub={t('sub', { count: stages.length })} action={action} flush>
      <ul>
        {stages.map((stage) => {
          const { collected, billedUnpaid } = stageSegments(stage);
          return (
            <li key={stage.id} className="border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 text-body-sm font-medium text-foreground">
                  {stage.name}{' '}
                  <span className="font-normal text-muted-foreground">
                    · {t('percent', { value: Math.round(Number(stage.percentage) * 1000) / 10 })}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {stage.amount !== null ? (
                    <span className="text-body-sm tabular-nums text-foreground">
                      {formatMoney(stage.amount, schedule.currency, locale)}
                    </span>
                  ) : null}
                  <StatusPill tone={statusTone(stage.collectionStatus, 'stageCollection')}>
                    {tCollection(stage.collectionStatus)}
                  </StatusPill>
                </span>
              </div>
              <SegmentBar
                className="mt-2"
                segments={[
                  { percent: collected, colour: 'chart-1' },
                  { percent: billedUnpaid, colour: 'chart-3' },
                ]}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2.5" aria-hidden="true">
        {[
          { label: t('legendCollected'), colour: 'var(--color-chart-1)' },
          { label: t('legendBilled'), colour: 'var(--color-chart-3)' },
          { label: t('legendNotBilled'), colour: 'var(--color-muted)' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <span className="size-2.5 rounded-xs border border-border" style={{ background: item.colour }} />
            {item.label}
          </span>
        ))}
      </div>
      {schedule.variationLines.length > 0 ? (
        <p className="border-t border-border px-4 py-2.5 text-caption text-muted-foreground">
          {t('variations', { count: schedule.variationLines.length })}
        </p>
      ) : null}
    </Panel>
  );
}

// ─── Cash coming and going ────────────────────────────────────────────────────

/** The forecast's current and dated periods; "later" and "undated" stay in the full forecast. */
export function cashflowGroups(
  data: CashflowForecastResponse,
  currency: string | null,
  labels: { now: string; month: (iso: string) => string },
) {
  const forecast = data.currencies.find((c) => c.currency === currency) ?? data.currencies[0] ?? null;
  if (!forecast) return null;
  const groups = forecast.buckets
    .filter((b) => b.kind === 'NOW' || b.kind === 'PERIOD')
    .map((b) => ({
      label: b.kind === 'NOW' ? labels.now : labels.month(b.start!),
      inflow: num(b.inflows.total) ?? 0,
      outflow: num(b.outflows.total) ?? 0,
    }));
  return { forecast, groups };
}

function CashFlow({ projectId, currency }: { projectId: string; currency: string | null }) {
  const t = useTranslations('finance.projects.dashboard.cashflow');
  const locale = useLocale() as Locale;
  const query = useCashflowForecast({ projectId, bucket: 'MONTH' });
  const action = <OpenLink href={`/finance/projects/${projectId}/cashflow`}>{t('open')}</OpenLink>;

  if (query.isPending) return <Skeleton className="h-72 w-full rounded-panel" />;
  if (query.isError) return <PanelError onRetry={() => void query.refetch()} />;

  const month = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const result = cashflowGroups(query.data, currency, { now: t('now'), month });
  const hasMoney = result?.groups.some((g) => g.inflow > 0 || g.outflow > 0) ?? false;

  if (!query.data.moneyVisible || !result || !hasMoney) {
    return (
      <Panel title={t('title')} action={action}>
        <p className="text-body-sm text-muted-foreground">{query.data.moneyVisible ? t('empty') : t('restricted')}</p>
      </Panel>
    );
  }

  const { forecast, groups } = result;
  const fmt = (value: string | null) => formatMoney(value, forecast.currency, locale) ?? '—';
  return (
    <Panel title={t('title')} sub={t('sub')} action={action}>
      <dl className="mb-3 grid grid-cols-3 gap-3">
        {[
          { label: t('in'), value: fmt(forecast.totals.inflows.total) },
          { label: t('out'), value: fmt(forecast.totals.outflows.total) },
          { label: t('net'), value: fmt(forecast.totals.net) },
        ].map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-caption text-muted-foreground">{item.label}</dt>
            <dd className="truncate text-body-sm font-semibold tabular-nums text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
      <InOutBars
        groups={groups}
        inLabel={t('in')}
        outLabel={t('out')}
        summary={t('summary', {
          count: groups.length,
          in: fmt(forecast.totals.inflows.total),
          out: fmt(forecast.totals.outflows.total),
        })}
      />
    </Panel>
  );
}

// ─── Cost against budget ──────────────────────────────────────────────────────

function CostVsBudget({ projectId, query }: { projectId: string; query: ReturnType<typeof useFinanceOverview> }) {
  const t = useTranslations('finance.projects.dashboard.cost');
  const action = <OpenLink href={`/finance/projects/${projectId}/cost`}>{t('open')}</OpenLink>;

  if (query.isPending) return <Skeleton className="h-72 w-full rounded-panel" />;
  if (query.isError) return <PanelError onRetry={() => void query.refetch()} />;

  const { costPosition: cost, currency } = query.data;
  const rows = [
    // One ramp, light to dark: the plan, what is promised, what has landed in the books.
    { key: 'budget', label: t('budget'), amount: cost.budgetTotal, colour: 'chart-3' as const },
    { key: 'committed', label: t('committed'), amount: cost.committedToDate, colour: 'chart-2' as const },
    { key: 'actual', label: t('actual'), amount: cost.actual, colour: 'chart-1' as const },
  ];
  const max = Math.max(...rows.map((r) => num(r.amount) ?? 0), 0);

  return (
    <Panel title={t('title')} sub={t('sub')} action={action}>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-body-sm text-muted-foreground">{r.label}</span>
              {r.key === 'budget' && r.amount === null ? (
                <span className="text-body-sm text-muted-foreground">{t('notBaselined')}</span>
              ) : (
                <Money amount={r.amount} currency={currency} className="text-body-sm font-semibold text-foreground" />
              )}
            </div>
            <ValueBar value={num(r.amount) ?? 0} max={max} colour={r.colour} />
          </li>
        ))}
      </ul>
      <p className="mt-4 text-caption text-muted-foreground">
        {cost.budgetTotal === null
          ? t('noBudgetHint')
          : cost.actualOfBudgetPercent === null
            ? null
            : t('spentOfBudget', { percent: cost.actualOfBudgetPercent })}
      </p>
    </Panel>
  );
}

// ─── What moved ─────────────────────────────────────────────────────────────

function RecentActivity({ query }: { query: ReturnType<typeof useFinanceOverview> }) {
  const t = useTranslations('finance.overview.activity');
  const tc = useTranslations('finance.common');
  const locale = useLocale() as Locale;

  if (query.isPending || query.isError) return null;
  const data = query.data;

  return (
    <Panel title={t('title')} sub={t('description')} flush>
      {data.activity.length === 0 ? (
        <p className="px-4 py-4 text-body-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul>
          {data.activity.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-body-sm font-medium text-foreground">{row.description}</p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {formatDate(row.date, locale) ?? row.date} · {row.source}
                  {row.reference ? ` · ${row.reference}` : ''}
                </p>
              </div>
              {/* Unsigned with Dr / Cr, as a ledger shows it — "−200,000" on an invoice reads as a loss. */}
              {row.amount === null ? null : (
                <span className="shrink-0 text-body-sm text-foreground">
                  <Money amount={Math.abs(Number(row.amount)).toFixed(2)} currency={data.currency} />{' '}
                  {/* A journal whose project lines net to nothing has no side. */}
                  {Number(row.amount) === 0 ? null : (
                    <span className="text-caption text-muted-foreground">{Number(row.amount) < 0 ? tc('credit') : tc('debit')}</span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
