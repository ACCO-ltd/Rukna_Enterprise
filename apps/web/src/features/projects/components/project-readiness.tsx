'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, cn } from '@erp/ui';
import { Check, LockKeyhole } from 'lucide-react';
import { usePermissions, type PermissionKey } from '@/features/auth/permissions/can';
import { useProjectReadiness } from '../hooks/use-project';
import type { ProjectDetail } from '../types';

const PREPARATION_ORDER = [
  'CLIENT_ACTIVE',
  'BOQ_BASELINED',
  'ACTIVE_MAIN_CONTRACT',
  'CONTRACT_START_DATE',
  'DELIVERY_TEAM',
  'PROGRAMME_DATES',
] as const;

type PreparationCode = (typeof PREPARATION_ORDER)[number];

const STEP_CONFIG: Record<
  PreparationCode,
  {
    path: string;
    permission: PermissionKey;
    owner: 'projectManager' | 'commercialTeam' | 'quantitySurveyor';
    dependsOn: PreparationCode[];
  }
> = {
  CLIENT_ACTIVE: {
    path: 'edit',
    permission: 'manage:project',
    owner: 'projectManager',
    dependsOn: [],
  },
  BOQ_BASELINED: {
    path: 'boq',
    permission: 'view:boq',
    owner: 'quantitySurveyor',
    dependsOn: ['CLIENT_ACTIVE'],
  },
  ACTIVE_MAIN_CONTRACT: {
    path: 'commercial/contract-security',
    permission: 'view:contract',
    owner: 'commercialTeam',
    dependsOn: ['CLIENT_ACTIVE', 'BOQ_BASELINED'],
  },
  CONTRACT_START_DATE: {
    path: 'commercial/contract-security',
    permission: 'view:contract',
    owner: 'commercialTeam',
    dependsOn: ['ACTIVE_MAIN_CONTRACT'],
  },
  DELIVERY_TEAM: {
    path: 'members',
    permission: 'manage:project-member',
    owner: 'projectManager',
    dependsOn: [],
  },
  PROGRAMME_DATES: {
    path: 'edit',
    permission: 'manage:project',
    owner: 'projectManager',
    dependsOn: [],
  },
};

/**
 * The server owns readiness truth. This component only adds the business sequence and
 * presentation dependencies that help a person understand what to do next.
 */
export function ProjectReadiness({ project }: { project: ProjectDetail }) {
  const t = useTranslations('platform.projects.preparation');
  const common = useTranslations('common');
  const { can } = usePermissions();
  const query = useProjectReadiness(project.id);

  if (query.isPending) return <p role="status">{common('loading')}</p>;
  if (query.isError)
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        <Button variant="outline" onClick={() => query.refetch()}>
          {common('grid.retry')}
        </Button>
      </Alert>
    );

  const conditions = new Map(query.data.conditions.map((condition) => [condition.code, condition]));
  const ordered = PREPARATION_ORDER.flatMap((code) => {
    const condition = conditions.get(code);
    return condition ? [{ code, condition }] : [];
  });
  const completedCount = ordered.filter(({ condition }) => condition.satisfied).length;

  return (
    <section
      className="rounded-panel border border-border bg-surface"
      aria-labelledby="project-readiness-title"
    >
      <div className="border-b border-border px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="project-readiness-title" className="text-h2 font-semibold">
            {t('title')}
          </h2>
          <span className="text-caption font-medium tabular-nums text-muted-foreground">
            {t('progress', { complete: completedCount, total: ordered.length })}
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-body-sm text-muted-foreground">
          {query.data.ready ? t('ready') : t('hint')}
        </p>
      </div>

      <ol className="px-5 sm:px-6">
        {ordered.map(({ code, condition }, index) => {
          const config = STEP_CONFIG[code];
          const unmetDependency = config.dependsOn.find(
            (dependency) => conditions.get(dependency)?.satisfied === false,
          );
          const blocked = !condition.satisfied && Boolean(unmetDependency);
          const actionable = !condition.satisfied && !blocked;

          return (
            <li
              key={code}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-b border-border py-4 last:border-b-0 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center"
            >
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border text-caption font-semibold tabular-nums',
                  condition.satisfied
                    ? 'border-success/25 bg-success-subtle text-success'
                    : actionable
                      ? 'border-brand-primary bg-brand-primary text-brand-on-primary'
                      : 'border-border bg-surface-subtle text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {condition.satisfied ? <Check size={15} strokeWidth={3} /> : index + 1}
              </span>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body-sm font-semibold">{t(`conditions.${code}`)}</p>
                  <StatusBadge
                    complete={condition.satisfied}
                    blocked={blocked}
                    waivable={condition.severity === 'WAIVABLE'}
                  />
                </div>
                <p className="mt-1 text-caption leading-5 text-muted-foreground">
                  {t(`descriptions.${code}`)}
                </p>
                <p className="mt-1 text-caption text-muted-foreground">{t(config.owner)}</p>
                {unmetDependency ? (
                  <p className="mt-2 flex items-center gap-1.5 text-caption font-medium text-warning">
                    <LockKeyhole size={13} aria-hidden="true" />
                    {t('blockedBy', { task: t(`conditions.${unmetDependency}`) })}
                  </p>
                ) : null}
              </div>

              <div className="col-start-2 mt-3 sm:col-start-3 sm:row-start-1 sm:mt-0">
                {actionable && can(config.permission) ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/projects/${project.id}/${config.path}`}>{t('resolve')}</Link>
                  </Button>
                ) : actionable ? (
                  <Badge tone="neutral">{t('ownerAction')}</Badge>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-border bg-surface-subtle px-5 py-4 sm:px-6">
        <p className="text-body-sm font-medium">
          {query.data.ready ? t('finalReady') : t('finalBlocked')}
        </p>
        <p className="mt-1 text-caption text-muted-foreground">{t('finalHint')}</p>
      </div>

      {query.data.deferred.length > 0 ? (
        <p className="border-t border-border px-5 py-4 text-caption text-muted-foreground sm:px-6">
          {t('deferred')}
        </p>
      ) : null}
    </section>
  );
}

function StatusBadge({
  complete,
  blocked,
  waivable,
}: {
  complete: boolean;
  blocked: boolean;
  waivable: boolean;
}) {
  const t = useTranslations('platform.projects.preparation');

  if (complete) return <Badge tone="live">{t('status.complete')}</Badge>;
  if (blocked) return <Badge tone="neutral">{t('status.blocked')}</Badge>;
  return (
    <Badge tone={waivable ? 'warning' : 'info'}>
      {waivable ? t('status.optional') : t('status.ready')}
    </Badge>
  );
}
