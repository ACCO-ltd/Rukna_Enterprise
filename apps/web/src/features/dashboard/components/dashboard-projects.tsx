'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CellPrimary, LtrValue, Meter, PanelHeader } from '@erp/ui';
import type {
  DashboardProjectInPreparation,
  DashboardProjectInProgress,
  ProjectStatus,
} from '@erp/types';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { formatMoney } from '@/lib/format';

type Locale = 'en' | 'ar';

/** A project falls "behind plan" on the dashboard once it is this many points under it. */
export const BEHIND_PLAN_POINTS = 5;

const renderLink = ({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) => (
  <Link href={href} className={className}>
    {children}
  </Link>
);

function ProjectCell({
  id,
  name,
  code,
  clientName,
}: {
  id: string;
  name: string;
  code: string;
  clientName: string | null;
}) {
  return (
    <CellPrimary
      href={`/projects/${id}`}
      label={name}
      sub={clientName ? `${code} · ${clientName}` : code}
      wrap
      renderLink={renderLink}
    />
  );
}

function AllProjectsLink() {
  const t = useTranslations('platform.dashboard.inProgress');
  return (
    <Link href="/projects" className="font-medium text-brand-primary hover:underline">
      {t('allProjects')}
    </Link>
  );
}

/** "2 more in preparation · 2 closed" — the other statuses as one quiet line (P31). */
export function useOtherStatusesLine() {
  const t = useTranslations('platform.dashboard.otherStatuses');
  return (counts: Record<string, number>, shown: readonly string[], more: boolean) =>
    (['DRAFT', 'ACTIVE', 'PRACTICAL_COMPLETION', 'CLOSEOUT', 'CLOSED', 'CANCELLED'] as const)
      .filter((status) => !shown.includes(status) && (counts[status] ?? 0) > 0)
      .map((status) =>
        status === 'DRAFT' && more
          ? t('DRAFT_MORE', { count: counts[status] ?? 0 })
          : t(status, { count: counts[status] ?? 0 }),
      )
      .join(' · ');
}

/** Progress: the meter with a plan tick, then the gap in words. */
function ProgressCell({ project }: { project: DashboardProjectInProgress }) {
  const t = useTranslations('platform.dashboard.inProgress');
  const { physicalPercent: physical, plannedPercent: planned } = project;
  if (physical === null)
    return <span className="text-caption text-muted-foreground">{t('notMeasured')}</span>;

  const behind = planned !== null ? Math.round(planned - physical) : null;
  const status =
    physical >= 100
      ? { text: t('complete'), className: 'text-muted-foreground' }
      : behind !== null && behind >= BEHIND_PLAN_POINTS
        ? { text: t('behind', { points: behind }), className: 'text-warning' }
        : planned === null
          ? { text: t('noPlan'), className: 'text-muted-foreground' }
          : { text: t('onPlan'), className: 'text-muted-foreground' };

  return (
    <div className="min-w-0">
      <span className="flex items-center gap-2">
        <Meter
          value={physical}
          target={planned}
          tone={status.className === 'text-warning' ? 'attention' : undefined}
          label={t('progressLabel', { project: project.name })}
        />
        <span className="text-body-sm font-semibold tabular-nums text-foreground">
          {Math.round(physical)}%
        </span>
      </span>
      <span className={`mt-0.5 block text-caption ${status.className}`}>{status.text}</span>
    </div>
  );
}

/** "Projects in progress" (or "My projects" for someone who sees only their own). */
export function ProjectsInProgressTable({
  projects,
  statusCounts,
  moneyVisible,
  mine,
}: {
  projects: readonly DashboardProjectInProgress[];
  statusCounts: Record<string, number>;
  moneyVisible: boolean;
  mine: boolean;
}) {
  const t = useTranslations('platform.dashboard.inProgress');
  const locale = useLocale() as Locale;
  const otherLine = useOtherStatusesLine();
  const money = (value: string | null, currency: string | null) =>
    value === null ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <LtrValue>{formatMoney(value, currency, locale)}</LtrValue>
    );

  const columns: GridColumn<DashboardProjectInProgress>[] = [
    {
      key: 'project',
      header: t('colProject'),
      card: 'title',
      render: (p) => (
        <ProjectCell id={p.id} name={p.name} code={p.code} clientName={p.clientName} />
      ),
    },
    {
      key: 'progress',
      header: t('colProgress'),
      card: 'meta',
      render: (p) => <ProgressCell project={p} />,
    },
  ];
  if (moneyVisible) {
    columns.push(
      {
        key: 'contractValue',
        header: t('colContractValue'),
        numeric: true,
        render: (p) => money(p.contractValue, p.currency),
      },
      {
        key: 'outstanding',
        header: t('colClientOwes'),
        numeric: true,
        card: 'amount',
        render: (p) => (
          <div>
            {money(p.outstanding, p.currency)}
            {p.overdue !== null && Number(p.overdue) > 0 ? (
              <span className="block text-caption font-medium text-danger">
                {t('overdue', { amount: formatMoney(p.overdue, p.currency, locale) ?? '' })}
              </span>
            ) : null}
          </div>
        ),
      },
    );
  }
  columns.push({
    key: 'status',
    header: t('colStatus'),
    card: 'status',
    render: (p) => <ProjectStatusBadge status={p.status as ProjectStatus} />,
  });

  const inProgressStatuses = ['ACTIVE', 'PRACTICAL_COMPLETION', 'CLOSEOUT'];
  return (
    <PlatformDataGrid
      data={[...projects]}
      columns={columns}
      rowKey={(p) => p.id}
      label={t('label')}
      toolbar={false}
      sortControl={false}
      header={
        <PanelHeader
          title={
            mine
              ? t('mineTitle', { count: projects.length })
              : t('title', { count: projects.length })
          }
          sub={otherLine(statusCounts, inProgressStatuses, true) || undefined}
          action={<AllProjectsLink />}
        />
      }
      emptyState={<p className="px-4 py-6 text-body-sm text-muted-foreground">{t('empty')}</p>}
    />
  );
}

/** "In preparation": what each project still needs before it can start (P32). */
export function ProjectsInPreparationTable({
  projects,
  moneyVisible,
}: {
  projects: readonly DashboardProjectInPreparation[];
  moneyVisible: boolean;
}) {
  const t = useTranslations('platform.dashboard.inPreparation');
  const steps = useTranslations('platform.projects.preparation');
  const locale = useLocale() as Locale;

  const stepTitle = (code: string) =>
    steps.has(`conditions.${code}` as never) ? steps(`conditions.${code}` as never) : code;

  const columns: GridColumn<DashboardProjectInPreparation>[] = [
    {
      key: 'project',
      header: t('colProject'),
      card: 'title',
      render: (p) => (
        <ProjectCell id={p.id} name={p.name} code={p.code} clientName={p.clientName} />
      ),
    },
    {
      key: 'ready',
      header: t('colReady'),
      card: 'meta',
      render: (p) => {
        const done = p.readiness.total > 0 && p.readiness.done === p.readiness.total;
        return (
          <span className="flex items-center gap-2">
            <Meter
              value={p.readiness.total > 0 ? (p.readiness.done / p.readiness.total) * 100 : 0}
              tone={done ? 'success' : undefined}
              label={t('readinessLabel', { project: p.name })}
            />
            <span className="text-body-sm tabular-nums text-foreground">
              {t('readyCount', { done: p.readiness.done, total: p.readiness.total })}
            </span>
          </span>
        );
      },
    },
    {
      key: 'nextStep',
      header: t('colNextStep'),
      card: 'status',
      render: (p) =>
        p.nextStep ? (
          <div className="min-w-0">
            <span className="block text-body-sm font-medium text-foreground">
              {stepTitle(p.nextStep.code)}
            </span>
            <span className="block text-caption text-muted-foreground">
              {steps(p.nextStep.owner)}
            </span>
          </div>
        ) : (
          <span className="text-body-sm font-medium text-success">{t('readyToStart')}</span>
        ),
    },
  ];
  if (moneyVisible) {
    columns.push({
      key: 'value',
      header: t('colValue'),
      numeric: true,
      card: 'amount',
      render: (p) =>
        p.value ? (
          <div>
            <LtrValue>{formatMoney(p.value.amount, p.value.currency, locale)}</LtrValue>
            {p.value.source === 'ESTIMATE' ? (
              <span className="block text-caption text-muted-foreground">{t('estimated')}</span>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    });
  }

  return (
    <PlatformDataGrid
      data={[...projects]}
      columns={columns}
      rowKey={(p) => p.id}
      label={t('label')}
      toolbar={false}
      sortControl={false}
      header={
        <PanelHeader
          title={t('title', { count: projects.length })}
          sub={t('sub')}
          action={<AllProjectsLink />}
        />
      }
    />
  );
}
