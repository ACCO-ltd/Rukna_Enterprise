'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, ReadinessChecklist, type ReadinessStep } from '@erp/ui';

import { usePermissions, type PermissionKey } from '@/features/auth/permissions/can';
import { formatDate } from '@/lib/format';
import type { ProjectReadinessConditionResponse } from '@erp/types';
import { useProjectReadiness } from '../hooks/use-project';
import { PROJECT_PERMISSIONS } from '../permissions';
import { getAvailableActions } from '../project-actions';
import type { ProjectDetail } from '../types';

/** The business order the steps are read in. Codes the server adds later are appended. */
const PREPARATION_ORDER = [
  'CLIENT_ACTIVE',
  'BOQ_BASELINED',
  'ACTIVE_MAIN_CONTRACT',
  'CONTRACT_START_DATE',
  'DELIVERY_TEAM',
  'PROGRAMME_DATES',
] as const;

type PreparationCode = (typeof PREPARATION_ORDER)[number];

/**
 * Where each step's work is done, who may open that place, and who owns the step.
 *
 * There is deliberately no dependency map here: which step waits for which is the server's
 * `blockedBy` on each condition (only genuine data dependencies — e.g. the contract start date
 * waits for the executed contract; since ADR-032 the contract does NOT wait for a baselined BOQ).
 * A client-side map would be a rule the API does not enforce.
 */
const STEP_CONFIG: Record<
  PreparationCode,
  {
    path: string;
    permission: PermissionKey;
    owner: 'projectManager' | 'commercialTeam' | 'quantitySurveyor';
  }
> = {
  CLIENT_ACTIVE: { path: 'edit', permission: 'manage:project', owner: 'projectManager' },
  BOQ_BASELINED: { path: 'boq', permission: 'view:boq', owner: 'quantitySurveyor' },
  // Straight to the page that does the job, not to a route that redirects to it.
  ACTIVE_MAIN_CONTRACT: {
    path: 'commercial/contract-milestones',
    permission: 'view:contract',
    owner: 'commercialTeam',
  },
  CONTRACT_START_DATE: {
    path: 'commercial/contract-milestones',
    permission: 'view:contract',
    owner: 'commercialTeam',
  },
  DELIVERY_TEAM: {
    path: 'members?add=1',
    permission: 'manage:project-member',
    owner: 'projectManager',
  },
  PROGRAMME_DATES: { path: 'edit', permission: 'manage:project', owner: 'projectManager' },
};

function isKnown(code: string): code is PreparationCode {
  return (PREPARATION_ORDER as readonly string[]).includes(code);
}

/** Known codes in business order, then any the server added that this client does not know. */
export function orderConditions(
  conditions: readonly ProjectReadinessConditionResponse[],
): ProjectReadinessConditionResponse[] {
  const rank = (code: string) =>
    isKnown(code) ? PREPARATION_ORDER.indexOf(code) : PREPARATION_ORDER.length;
  return [...conditions].sort((a, b) => rank(a.code) - rank(b.code));
}

/**
 * The Preparation-stage question — what is left before this project can start? — answered from
 * the server's readiness contract. The server owns the truth (which conditions exist, which are
 * met, which are waivable); this adds the reading order, the owner, and where to go to do it.
 */
export function ProjectReadiness({ project }: { project: ProjectDetail }) {
  const t = useTranslations('platform.projects.preparation');
  const common = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
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

  const titleOf = (condition: ProjectReadinessConditionResponse) =>
    isKnown(condition.code) && t.has(`conditions.${condition.code}`)
      ? t(`conditions.${condition.code}`)
      : condition.detail;
  const byCode = new Map(query.data.conditions.map((condition) => [condition.code, condition]));

  const steps: ReadinessStep[] = orderConditions(query.data.conditions).map((condition) => {
    const config = isKnown(condition.code) ? STEP_CONFIG[condition.code] : null;
    const href = config ? `/projects/${project.id}/${config.path}` : undefined;
    const title = titleOf(condition);
    // Waiting = an unmet step whose server-declared prerequisite is itself unmet. It gets no
    // action: the work cannot be done until the prerequisite is.
    const blocker = condition.satisfied
      ? undefined
      : (condition.blockedBy ?? [])
          .map((code) => byCode.get(code))
          .find((dependency) => dependency && !dependency.satisfied);
    const doneAt =
      condition.satisfied && condition.satisfiedAt
        ? (formatDate(condition.satisfiedAt, locale) ?? undefined)
        : undefined;

    return {
      key: condition.code,
      title,
      description:
        config && t.has(`descriptions.${condition.code}`)
          ? t(`descriptions.${condition.code}`)
          : undefined,
      owner: config ? t(config.owner) : undefined,
      state: condition.satisfied ? 'done' : blocker ? 'waiting' : 'open',
      waitingFor: blocker ? titleOf(blocker) : undefined,
      doneAt,
      optional: condition.severity === 'WAIVABLE',
      // A done row links to where the work was done only when the reader can open that place.
      href: config && can(config.permission) ? href : undefined,
      action:
        !condition.satisfied && !blocker && config && href && can(config.permission) ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href}>{t(`action.${condition.code}`)}</Link>
          </Button>
        ) : undefined,
    };
  });

  const requiredOpen = steps.some((step) => step.state !== 'done' && !step.optional);
  const optionalOpen = steps.some((step) => step.state !== 'done' && step.optional);
  // The footnote talks about the header's Start button, so it only does so to someone the
  // button can appear for; everyone else gets the plain statement of what starting does.
  const mayStart = can(PROJECT_PERMISSIONS.manage) && getAvailableActions(project).advance === 'start';
  const footnote = !mayStart
    ? t('footnoteReadOnly')
    : requiredOpen
      ? t('footnoteRequired')
      : optionalOpen
        ? t('footnoteOptional')
        : t('footnoteReady');

  return (
    <ReadinessChecklist
      headingId="project-readiness-title"
      title={t('title')}
      steps={steps}
      linkAs={Link}
      footnote={
        <>
          {footnote}
          {query.data.deferred.length > 0 ? (
            <span className="mt-1 block">{t('deferred')}</span>
          ) : null}
        </>
      }
      labels={{
        countOf: (total) => t('countOf', { total }),
        progress: (done, total) => t('progressLabel', { done, total }),
        summaryRequired: (count) => t('summaryRequired', { count }),
        summaryOptional: (count) => t('summaryOptional', { count }),
        summaryAllDone: t('summaryAllDone'),
        optional: t('optional'),
        skippable: t('skippable'),
        waitsFor: (step) =>
          t.rich('waitsFor', {
            step: typeof step === 'string' ? step : '',
            b: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong>,
          }),
        doneToggle: (count) => t('doneToggle', { count }),
        show: t('show'),
        hide: t('hide'),
      }}
    />
  );
}
