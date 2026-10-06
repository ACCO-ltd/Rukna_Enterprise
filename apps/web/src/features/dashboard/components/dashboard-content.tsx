'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  ActivityTimeline,
  Alert,
  Button,
  Panel,
  ReadinessChecklist,
  type ReadinessStep,
} from '@erp/ui';
import type { DashboardResponse, DashboardSetupStepCode } from '@erp/types';

import { ModuleHeader } from '@/components/layout/module-chrome';
import { useProjectActivityEntries } from '@/features/projects/activity-labels';
import { formatDate } from '@/lib/format';

import { useDashboard } from '../hooks';
import { DashboardFigureStrips, ReceivablesByAge } from './dashboard-money';
import { ProjectsInPreparationTable, ProjectsInProgressTable } from './dashboard-projects';
import { DashboardTodo } from './dashboard-todo';

type Locale = 'en' | 'ar';

/** Where each setup step's work is done. */
const SETUP_HREF: Record<DashboardSetupStepCode, string> = {
  CLIENT: '/clients/new',
  PROJECT: '/projects/new',
  ACCOUNTING: '/finance/accounting/guide',
  SUPPLIERS: '/procurement/suppliers',
  TEAM: '/admin/users',
};

/**
 * The landing page (P30–P32). It answers, in order: what needs me, where the money stands, how
 * each project is doing — and follows the company's stage and the reader's permissions, both
 * decided by `GET /dashboard`. No primary button: the dashboard has no primary action.
 */
export function DashboardContent() {
  const t = useTranslations('platform.dashboard');
  const locale = useLocale() as Locale;
  const query = useDashboard();
  const today = formatDate(new Date().toISOString(), locale) ?? '';

  const header = (company?: string) => (
    <ModuleHeader
      title={t('title')}
      crumbs={[]}
      description={company ? t('subtitle', { company, today }) : today}
    />
  );

  if (query.isPending) {
    return (
      <>
        {header()}
        <DashboardSkeleton />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        {header()}
        <Alert variant="error" messages={[t('loadFailed')]}>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              {t('retry')}
            </Button>
          </div>
        </Alert>
      </>
    );
  }

  const data = query.data;
  return (
    <>
      {header(data.organizationName)}
      {data.stage === 'NEW' ? <SetupView data={data} /> : <WorkView data={data} />}
    </>
  );
}

/** Stages PREPARATION and RUNNING: figures, To do beside the rail, then the projects. */
function WorkView({ data }: { data: DashboardResponse }) {
  const t = useTranslations('platform.dashboard');
  const toEntries = useProjectActivityEntries();
  const running = data.stage === 'RUNNING';
  // P31: no strip of zeros — only money roles, only once something is active or invoiced.
  const figures =
    running && data.moneyVisible && data.figures && data.figures.length > 0 ? data.figures : null;

  return (
    <div className="space-y-6">
      {figures ? <DashboardFigureStrips figures={figures} /> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <DashboardTodo items={data.todo} />
        <div className="space-y-6">
          {figures ? <ReceivablesByAge figures={figures} /> : null}
          <Panel title={t('activity.title')}>
            <ActivityTimeline
              compact
              label={t('activity.title')}
              entries={toEntries(data.activity).map((entry, i) => {
                // Across projects an event that names no record still says which project it was.
                const project = data.activity[i]?.project;
                return entry.target || !project
                  ? entry
                  : { ...entry, target: project.name, href: `/projects/${project.id}` };
              })}
              renderLink={({ href, className, children }) => (
                <Link href={href} className={className}>
                  {children}
                </Link>
              )}
              empty={<p className="text-body-sm text-muted-foreground">{t('activity.empty')}</p>}
            />
          </Panel>
        </div>
      </div>

      {running ? (
        <ProjectsInProgressTable
          projects={data.projects.inProgress}
          statusCounts={data.projects.statusCounts}
          moneyVisible={data.moneyVisible}
          mine={data.projectScope === 'MINE'}
        />
      ) : (
        <ProjectsInPreparationTable
          projects={data.projects.inPreparation}
          moneyVisible={data.moneyVisible}
        />
      )}
    </div>
  );
}

/** Stage NEW: "Get {company} ready" replaces everything else (P32). */
function SetupView({ data }: { data: DashboardResponse }) {
  const t = useTranslations('platform.dashboard.setup');
  const steps: ReadinessStep[] = (data.setup ?? []).map((step) => ({
    key: step.code,
    title: t(`steps.${step.code}.title`),
    description: t(`steps.${step.code}.description`),
    owner: t(`steps.${step.code}.owner`),
    state: step.done ? 'done' : 'open',
    optional: step.optional,
    href: step.canAct ? SETUP_HREF[step.code] : undefined,
    // Action buttons only for people who may do the step.
    action:
      !step.done && step.canAct ? (
        <Button asChild variant="outline" size="sm">
          <Link href={SETUP_HREF[step.code]}>{t(`steps.${step.code}.action`)}</Link>
        </Button>
      ) : undefined,
  }));
  const requiredLeft = steps.filter((s) => s.state !== 'done' && !s.optional).length;

  return (
    <ReadinessChecklist
      title={t('title', { company: data.organizationName })}
      steps={steps}
      summary={requiredLeft > 0 ? t('summary', { count: requiredLeft }) : t('summaryDone')}
      footnote={t('footnote')}
      labels={{ skippable: t('optionalHint') }}
      linkAs={Link}
      className="rounded-panel border border-border bg-surface p-4 sm:p-6"
    />
  );
}

function DashboardSkeleton() {
  const t = useTranslations('common');
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{t('loading')}</span>
      <div className="grid grid-cols-2 border-y border-border lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`space-y-2 px-4 py-3 ${i === 0 ? '' : 'border-s border-border'}`}>
            <div className="h-3 w-24 animate-pulse rounded-control bg-muted" />
            <div className="h-7 w-28 animate-pulse rounded-control bg-muted" />
          </div>
        ))}
      </div>
      <div
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]"
        aria-hidden="true"
      >
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" />
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" />
      </div>
    </div>
  );
}
