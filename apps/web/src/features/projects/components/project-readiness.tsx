'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Check, Info, ListChecks, Lock } from 'lucide-react';
import { Badge, Button, cn, RecordPanel } from '@erp/ui';

import type { ProjectDetail, ProjectWorkspaceSummary } from '../types';

type ProjectSetup = ProjectWorkspaceSummary['setup'];

type StepState = 'complete' | 'actionable' | 'pending' | 'blocked';

interface ReadinessStep {
  key: 'project' | 'boq' | 'contract' | 'team';
  labelKey: 'setupProject' | 'setupBoq' | 'setupContract' | 'setupTeam';
  descKey: 'setupProjectDesc' | 'setupBoqDesc' | 'setupContractDesc' | 'setupTeamDesc';
  complete: boolean;
  /** Cannot be acted on yet — a prior step has to be done first. */
  locked: boolean;
  href?: string;
  actionKey?: 'openBoq' | 'createContract' | 'addMembers';
}

/**
 * What is left before this project can start, as a checklist.
 *
 * It replaces a four-node horizontal stepper. The steps are not peers — a main contract cannot
 * exist until the BOQ is baselined — and four equal boxes in a row is precisely the shape that
 * hides a dependency. Read top to bottom, the order *is* the dependency, and the one step that
 * is blocked says so on its own line instead of in a paragraph underneath.
 *
 * The section disappears the moment the project leaves preparation. A permanent "4 of 4
 * complete" panel on a running project is a monument to work finished months ago.
 */
export function ProjectReadiness({
  project,
  setup,
}: {
  project: ProjectDetail;
  setup: ProjectSetup;
}) {
  const t = useTranslations('platform.projects.detail');

  const steps: ReadinessStep[] = [
    {
      key: 'project',
      labelKey: 'setupProject',
      descKey: 'setupProjectDesc',
      complete: true,
      locked: false,
    },
    {
      key: 'boq',
      labelKey: 'setupBoq',
      descKey: 'setupBoqDesc',
      complete: setup.boqBaselined,
      locked: false,
      href: `/projects/${project.id}/boq`,
      actionKey: 'openBoq',
    },
    // Internal-capital projects have no client contract, and the server counts three steps for
    // them rather than four. Rendering a step the readiness maths does not count would put
    // "1 of 3 complete" above a list of four.
    ...(setup.mainContractApplicable
      ? [
          {
            key: 'contract' as const,
            labelKey: 'setupContract' as const,
            descKey: 'setupContractDesc' as const,
            complete: setup.mainContractExists,
            locked: !setup.boqBaselined,
            href: setup.boqBaselined ? `/contracts/new?projectId=${project.id}` : undefined,
            actionKey: 'createContract' as const,
          },
        ]
      : []),
    {
      key: 'team',
      labelKey: 'setupTeam',
      descKey: 'setupTeamDesc',
      complete: setup.teamReady,
      locked: false,
      href: `/projects/${project.id}/members`,
      actionKey: 'addMembers',
    },
  ];

  const done = setup.completedSteps;
  const total = setup.totalSteps;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const ready = done >= total;
  // The first step someone can actually start is the one the eye should land on. Later
  // unblocked steps keep their action but not the emphasis — two blue markers would be two
  // answers to "what now".
  const firstActionableIndex = steps.findIndex((step) => !step.complete && !step.locked);
  const contractBlocked = steps.some((step) => step.key === 'contract' && step.locked);

  return (
    <RecordPanel
      title={t('readiness')}
      meta={t('readinessHint')}
      icon={<ListChecks size={17} strokeWidth={1.9} />}
      action={
        <span className="text-caption font-medium text-muted-foreground">
          {ready ? t('readinessReady') : t('readinessProgress', { done, total })}
        </span>
      }
    >
      <div className="flex items-center gap-3">
        <div
          className="h-1 w-full min-w-0 max-w-xs overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={t('readiness')}
        >
          <div
            className={cn('h-full rounded-full', ready ? 'bg-success' : 'bg-brand-primary')}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="shrink-0 text-caption font-medium tabular-nums text-muted-foreground">
          {t('readinessPercent', { percent })}
        </span>
      </div>

      {/* Separated by space rather than by a rule per row. Each step already has a strong
          left marker and a bold title, which is enough to delimit it, and the panel around
          all four is what says where the group starts and ends. */}
      <ol className="mt-5 flex flex-col gap-4">
        {steps.map((step, index) => {
          const state: StepState = step.complete
            ? 'complete'
            : step.locked
              ? 'blocked'
              : index === firstActionableIndex
                ? 'actionable'
                : 'pending';

          return (
            <li key={step.key} className="flex items-start gap-3">
              <StepMarker index={index} state={state} />

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-body-sm font-semibold',
                    state === 'blocked' ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {t(step.labelKey)}
                </p>
                <p className="mt-0.5 text-caption leading-5 text-muted-foreground">
                  {t(step.descKey)}
                </p>
              </div>

              <div className="shrink-0">
                {state === 'blocked' ? (
                  <Badge tone="warning">{t('setupBlocked')}</Badge>
                ) : !step.complete && step.href && step.actionKey ? (
                  // The current step gets the outlined button; a later step that is genuinely
                  // open keeps its action but in a quieter form. Nothing is disabled — the team
                  // can legitimately be assigned before the contract exists, and the server
                  // imposes no such dependency. The weighting says "recommended next", not
                  // "blocked", which is what the amber lock above is for.
                  <Button variant={state === 'actionable' ? 'outline' : 'ghost'} size="sm" asChild>
                    <Link href={step.href} className="gap-2">
                      {t(step.actionKey)}
                      <ArrowRight size={14} className="rtl:rotate-180" aria-hidden="true" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* One notice, not one per step. The blocked row already carries the badge; this says
          what unblocks it, once. */}
      {contractBlocked ? (
        <p className="mt-5 flex items-start gap-2 rounded-control bg-surface-subtle px-3 py-2.5 text-caption leading-5 text-muted-foreground">
          <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('setupContractNote')}
        </p>
      ) : null}
    </RecordPanel>
  );
}

function StepMarker({ index, state }: { index: number; state: StepState }) {
  if (state === 'complete') {
    return (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Check size={13} strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }

  if (state === 'blocked') {
    return (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-warning/30 bg-warning-subtle text-warning">
        <Lock size={12} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-bold tabular-nums',
        state === 'actionable'
          ? 'bg-brand-primary text-brand-on-primary'
          : 'border border-border bg-surface text-muted-foreground',
      )}
    >
      {index + 1}
    </span>
  );
}
