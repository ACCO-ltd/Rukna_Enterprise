'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button } from '@erp/ui';
import { Check, Circle } from 'lucide-react';
import { usePermissions, type PermissionKey } from '@/features/auth/permissions/can';
import { useProjectReadiness } from '../hooks/use-project';
import type { ProjectDetail } from '../types';

const DESTINATIONS: Record<
  string,
  {
    path: string;
    permission: PermissionKey;
    owner: 'projectManager' | 'commercialTeam' | 'quantitySurveyor';
  }
> = {
  CLIENT_ACTIVE: { path: 'edit', permission: 'manage:project', owner: 'projectManager' },
  BOQ_BASELINED: { path: 'boq', permission: 'view:boq', owner: 'quantitySurveyor' },
  ACTIVE_MAIN_CONTRACT: {
    path: 'commercial/contract-security',
    permission: 'view:contract',
    owner: 'commercialTeam',
  },
  CONTRACT_START_DATE: {
    path: 'commercial/contract-security',
    permission: 'view:contract',
    owner: 'commercialTeam',
  },
  PROGRAMME_DATES: { path: 'edit', permission: 'manage:project', owner: 'projectManager' },
  DELIVERY_TEAM: { path: 'members', permission: 'manage:project-member', owner: 'projectManager' },
};

/** Conditions are the server's start gate, never a second readiness calculation. */
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
  const remaining = query.data.conditions.filter((condition) => !condition.satisfied);
  const completed = query.data.conditions.filter((condition) => condition.satisfied);
  return (
    <section
      className="rounded-panel border border-border bg-surface p-5 sm:p-6"
      aria-labelledby="project-readiness-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="project-readiness-title" className="text-h2 font-semibold">
          {t('title')}
        </h2>
        <span className="text-caption text-muted-foreground">
          {t('remaining', { count: remaining.length })}
        </span>
      </div>
      <p className="mt-2 text-body-sm text-muted-foreground">
        {query.data.ready ? t('ready') : t('hint')}
      </p>
      <ul className="mt-5 divide-y divide-border">
        {remaining.map((condition) => {
          const destination = DESTINATIONS[condition.code];
          const label = t.has(`conditions.${condition.code}`)
            ? t(`conditions.${condition.code}`)
            : condition.detail;
          return (
            <li key={condition.code} className="flex flex-wrap items-start gap-3 py-4">
              <Circle size={16} className="mt-1 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium">{label}</p>
                <p className="mt-1 text-caption text-muted-foreground">
                  {destination ? t(destination.owner) : t('projectManager')}
                </p>
                {condition.severity === 'WAIVABLE' ? (
                  <p className="mt-1 text-caption text-muted-foreground">{t('waivable')}</p>
                ) : null}
              </div>
              {destination && can(destination.permission) ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/projects/${project.id}/${destination.path}`}>{t('resolve')}</Link>
                </Button>
              ) : (
                <Badge tone="neutral">{t('ownerAction')}</Badge>
              )}
            </li>
          );
        })}
      </ul>
      {completed.length > 0 ? (
        <details className="mt-4 border-t border-border pt-4">
          <summary className="cursor-pointer text-body-sm text-muted-foreground">
            {t('completed', { count: completed.length })}
          </summary>
          <ul className="mt-3 space-y-3">
            {completed.map((condition) => (
              <li key={condition.code} className="flex items-center gap-2 text-body-sm">
                <Check size={15} className="text-success" aria-hidden="true" />
                {t.has(`conditions.${condition.code}`)
                  ? t(`conditions.${condition.code}`)
                  : condition.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {query.data.deferred.length > 0 ? (
        <p className="mt-4 text-caption text-muted-foreground">{t('deferred')}</p>
      ) : null}
    </section>
  );
}
