'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Info,
  LayoutGrid,
  Receipt,
  Scale,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import type { FinanceAttentionItem, ProjectFinanceOverviewResponse } from '@erp/types';

import { formatDate } from '@/lib/format';
import { SectionPanel } from '@/features/procurement/components/project/section-panel';

import { useFinanceOverview } from '../hooks/use-finance';
import {
  ControlRow,
  InlineRatio,
  Metric,
  MetricBand,
  Money,
  RatioBar,
  UnavailableNotice,
} from './finance-primitives';

/**
 * The project's financial control page.
 *
 * It answers four questions in order: what has this project committed and spent, what did the
 * accounts recognise, **can these numbers be trusted**, and what needs acting on. The third is
 * why this page exists at all — the audit behind this workspace found a Finance tab whose
 * headline figure was a forecast containing no forecast, over a cost base that was structurally
 * $0 because no bill carried a project. A control strip that reports reconciliation, accounting
 * setup, budget state and period state is worth more here than another chart.
 *
 * Nothing on this page is computed in the browser. Every figure and every status comes from the
 * one Finance Overview read, which itself reuses the cost rollup Cost Control renders — so the
 * two screens cannot show different numbers for the same thing.
 */
export function FinanceOverviewView({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.overview');
  const tc = useTranslations('finance.common');
  const locale = useLocale() as 'en' | 'ar';
  const query = useFinanceOverview(projectId);

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
  const { costPosition: cost, accountingPosition: accounting } = data;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <CostPosition data={data} />
          <AccountingPosition data={data} />
        </div>
        <div className="min-w-0 space-y-6">
          <ControlStatus data={data} />
          <NeedsAttention items={data.attention} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <CostByArea data={data} projectId={projectId} />
        <RecentActivity data={data} locale={locale} />
      </div>
    </div>
  );

  function CostPosition({ data }: { data: ProjectFinanceOverviewResponse }) {
    const hasBudget = cost.budgetTotal !== null;
    return (
      <MetricBand
        title={t('costPosition.title')}
        description={t('costPosition.description')}
        icon={<Wallet size={16} strokeWidth={1.9} />}
        columns={5}
        footer={
          // Drawn as well as written: a column of percentages is only comparable at a glance
          // once it has a shape. Absent, not 0%, when nothing is baselined.
          <div className="grid gap-3 sm:grid-cols-2">
            <RatioBar
              label={t('ratio.committed')}
              percent={cost.committedOfBudgetPercent}
            />
            <RatioBar label={t('ratio.actual')} percent={cost.actualOfBudgetPercent} />
          </div>
        }
      >
        <Metric
          label={t('costPosition.budget')}
          amount={cost.budgetTotal}
          currency={data.currency}
          basis={hasBudget ? t('costPosition.budgetBasis') : t('costPosition.notBaselined')}
          unavailableLabel={
            data.financialsVisible ? t('costPosition.notBaselined') : tc('restricted')
          }
        />
        <Metric
          label={t('costPosition.openCommitment')}
          amount={cost.committed}
          currency={data.currency}
          basis={t('costPosition.openCommitmentBasis')}
          unavailableLabel={tc('restricted')}
        />
        <Metric
          label={t('costPosition.accrued')}
          amount={cost.accrued}
          currency={data.currency}
          basis={t('costPosition.accruedBasis')}
          unavailableLabel={tc('restricted')}
        />
        <Metric
          label={t('costPosition.actual')}
          amount={cost.actual}
          currency={data.currency}
          basis={t('costPosition.actualBasis')}
          emphasis
          unavailableLabel={tc('restricted')}
        />
        {/* Absent rather than zero when nothing is baselined: a project with no budget has no
            headroom figure, and rendering one invents a control nobody configured. */}
        <Metric
          label={t('costPosition.uncommittedBudget')}
          amount={cost.uncommittedBudget}
          currency={data.currency}
          basis={t('costPosition.uncommittedBudgetBasis')}
          overrunLabel={tc('overrun')}
          unavailableLabel={
            data.financialsVisible ? t('costPosition.notBaselined') : tc('restricted')
          }
        />
      </MetricBand>
    );
  }

  function AccountingPosition({ data }: { data: ProjectFinanceOverviewResponse }) {
    if (!accounting.available) {
      return (
        <SectionPanel
          title={t('accountingPosition.title')}
          description={t('accountingPosition.description')}
        >
          <div className="p-4 sm:p-5">
            <UnavailableNotice
              title={t('accountingPosition.unavailableTitle')}
              reason={
                data.financialsVisible
                  ? t('accountingPosition.unavailableReason')
                  : tc('restrictedReason')
              }
              items={accounting.blockers.map((b) => ({ label: b.label, detail: b.detail }))}
            />
          </div>
        </SectionPanel>
      );
    }

    return (
      <MetricBand
        title={t('accountingPosition.title')}
        description={t('accountingPosition.description')}
        icon={<Receipt size={16} strokeWidth={1.9} />}
        columns={4}
      >
        <Metric
          label={t('accountingPosition.revenue')}
          amount={accounting.revenue}
          currency={data.currency}
          basis={t('accountingPosition.revenueBasis')}
        />
        <Metric
          label={t('accountingPosition.projectCost')}
          amount={accounting.projectCost}
          currency={data.currency}
          basis={t('accountingPosition.projectCostBasis')}
        />
        <Metric
          label={t('accountingPosition.grossProfit')}
          amount={accounting.grossProfit}
          currency={data.currency}
          emphasis
        />
        <div className="min-w-0 border-b border-border px-4 py-3.5 last:border-b-0 sm:nth-last-2:border-b-0 sm:odd:border-e xl:border-b-0 xl:not-last:border-e">
          <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t('accountingPosition.margin')}
          </dt>
          <dd className="mt-1.5 text-h2 font-bold tabular-nums text-foreground">
            {/* No revenue means no denominator. 0% would claim the project broke even. */}
            {accounting.marginPercent === null ? (
              <span className="text-body-sm font-medium text-muted-foreground">
                {tc('unavailable')}
              </span>
            ) : (
              `${accounting.marginPercent}%`
            )}
          </dd>
          <dd className="mt-1 text-caption text-muted-foreground">
            {t('accountingPosition.marginBasis')}
          </dd>
        </div>
      </MetricBand>
    );
  }

  function ControlStatus({ data }: { data: ProjectFinanceOverviewResponse }) {
    const { controls, reconciliation, budget, period } = data;
    return (
      <SectionPanel
        title={t('controls.title')}
        description={t('controls.description')}
        icon={<ShieldCheck size={16} strokeWidth={1.9} />}
        bodyClassName="p-0"
      >
        <div>
          <ControlRow
            icon={<Scale size={16} strokeWidth={1.9} />}
            label={t('controls.reconciliation')}
            status={controls.reconciliation}
            detail={t('controls.reconciliationDetail', { variance: reconciliation.variance })}
          />
          <ControlRow
            icon={<Settings2 size={16} strokeWidth={1.9} />}
            label={t('controls.accountingSetup')}
            status={controls.accountingSetup}
          />
          <ControlRow
            icon={<ClipboardCheck size={16} strokeWidth={1.9} />}
            label={t('controls.costBudget')}
            status={controls.costBudget}
            detail={
              budget.status === 'BASELINED' && budget.baselinedAt
                ? t('controls.budgetDetail', {
                    version: budget.versionNumber ?? 0,
                    date: formatDate(budget.baselinedAt, locale) ?? budget.baselinedAt,
                  })
                : undefined
            }
          />
          <ControlRow
            icon={<CalendarClock size={16} strokeWidth={1.9} />}
            label={t('controls.period')}
            status={controls.period}
            detail={
              period
                ? t('controls.periodDetail', {
                    name: period.name,
                    days: period.daysToPeriodEnd,
                  })
                : undefined
            }
          />
        </div>

        {/* Non-procurement project cost is not a variance. Naming it separately is what stops
            someone "fixing" a healthy reconciliation by forcing payroll through procurement. */}
        {reconciliation.reconciled && Number(reconciliation.glNonProcurementCost) !== 0 ? (
          <p className="border-t border-border px-4 py-2.5 text-caption text-muted-foreground sm:px-5">
            {t('controls.nonProcurementNote', {
              procurement: reconciliation.glProcurementCost,
              other: reconciliation.glNonProcurementCost,
              total: reconciliation.glTotalProjectCost,
            })}
          </p>
        ) : null}
      </SectionPanel>
    );
  }

  function NeedsAttention({ items }: { items: FinanceAttentionItem[] }) {
    if (items.length === 0) {
      return (
        <SectionPanel title={t('attention.title')}>
          <p className="px-4 py-5 text-body-sm text-muted-foreground sm:px-5">
            {t('attention.empty')}
          </p>
        </SectionPanel>
      );
    }

    const ICON = {
      CRITICAL: TriangleAlert,
      WARNING: AlertTriangle,
      INFO: Info,
    } as const;
    const TONE = { CRITICAL: 'danger', WARNING: 'warning', INFO: 'neutral' } as const;

    return (
      <SectionPanel
        title={t('attention.title')}
        icon={<TriangleAlert size={16} strokeWidth={1.9} />}
        action={<Badge tone="neutral">{items.length}</Badge>}
        bodyClassName="p-0"
      >
        <ul>
          {items.map((item) => {
            const Icon = ICON[item.severity];
            const body = (
              <>
                <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
                  <Icon size={16} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-caption text-muted-foreground">
                    {item.detail}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge tone={TONE[item.severity]}>
                    {t(`attention.severity.${item.severity}`)}
                  </Badge>
                  {item.href ? (
                    <ChevronRight
                      size={15}
                      strokeWidth={2}
                      className="text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={item.code} className="border-b border-border last:border-b-0">
                {/* A link only where a real destination exists — a row that looks clickable and
                    goes nowhere teaches people to stop clicking. */}
                {item.href ? (
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-start gap-2.5 px-4 py-3 hover:bg-muted sm:px-5"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-2.5 px-4 py-3 sm:px-5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </SectionPanel>
    );
  }

  function CostByArea({
    data,
    projectId,
  }: {
    data: ProjectFinanceOverviewResponse;
    projectId: string;
  }) {
    if (data.costByArea.length === 0) {
      return (
        <SectionPanel title={t('costByArea.title')} description={t('costByArea.description')}>
          <p className="px-4 py-5 text-body-sm text-muted-foreground sm:px-5">
            {t('costByArea.empty')}
          </p>
        </SectionPanel>
      );
    }

    return (
      <SectionPanel
        title={t('costByArea.title')}
        description={t('costByArea.description')}
        icon={<LayoutGrid size={16} strokeWidth={1.9} />}
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/projects/${projectId}/finance/cost-control`}>
              {t('costByArea.openCostControl')}
              <ArrowRight size={15} strokeWidth={1.9} aria-hidden="true" />
            </Link>
          </Button>
        }
        bodyClassName="p-0"
      >
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('costByArea.area')}</TableHead>
                <TableHead className="text-end">{t('costByArea.budget')}</TableHead>
                <TableHead className="text-end">{t('costByArea.openCommitment')}</TableHead>
                <TableHead className="text-end">{t('costByArea.actual')}</TableHead>
                <TableHead className="text-end">{t('ratio.actual')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.costByArea.map((row) => (
                <TableRow key={`${row.kind}-${row.boqNodeId ?? row.description}`}>
                  <TableCell className="font-medium text-foreground">
                    {row.code ? `${row.code} · ` : ''}
                    {row.description}
                  </TableCell>
                  <TableCell className="text-end">
                    <Money amount={row.budget} currency={data.currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Money amount={row.committed} currency={data.currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Money amount={row.actual} currency={data.currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <InlineRatio
                      percent={row.actualOfBudgetPercent}
                      label={`${t('ratio.actual')} ${row.description}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {/* The total ties back to the position band above. Without it a reader has to
                  add four rows in their head to check the two agree. */}
              <TableRow className="bg-muted/40">
                <TableCell className="font-semibold text-foreground">{tc('total')}</TableCell>
                <TableCell className="text-end font-semibold">
                  <Money amount={cost.budgetTotal} currency={data.currency} />
                </TableCell>
                <TableCell className="text-end font-semibold">
                  <Money amount={cost.committed} currency={data.currency} />
                </TableCell>
                <TableCell className="text-end font-semibold">
                  <Money amount={cost.actual} currency={data.currency} />
                </TableCell>
                <TableCell className="text-end">
                  <InlineRatio
                    percent={cost.actualOfBudgetPercent}
                    label={t('ratio.actual') + ' ' + tc('total')}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableScroll>
      </SectionPanel>
    );
  }

  function RecentActivity({
    data,
    locale,
  }: {
    data: ProjectFinanceOverviewResponse;
    locale: 'en' | 'ar';
  }) {
    if (data.activity.length === 0) {
      return (
        <SectionPanel title={t('activity.title')} description={t('activity.description')}>
          <p className="px-4 py-5 text-body-sm text-muted-foreground sm:px-5">
            {t('activity.empty')}
          </p>
        </SectionPanel>
      );
    }

    return (
      <SectionPanel
        title={t('activity.title')}
        description={t('activity.description')}
        icon={<Activity size={16} strokeWidth={1.9} />}
        bodyClassName="p-0"
      >
        <ul>
          {data.activity.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:px-5"
            >
              <div className="min-w-0">
                <p className="truncate text-body-sm font-medium text-foreground">
                  {row.description}
                </p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {formatDate(row.date, locale) ?? row.date}
                  {' · '}
                  {row.source}
                  {row.reference ? ` · ${row.reference}` : ''}
                </p>
              </div>
              {/* A budget baseline moves no money; showing an amount would invent one. */}
              {row.amount === null ? null : (
                <Money
                  amount={row.amount}
                  currency={data.currency}
                  className="shrink-0 text-body-sm text-foreground"
                />
              )}
            </li>
          ))}
        </ul>
      </SectionPanel>
    );
  }
}
