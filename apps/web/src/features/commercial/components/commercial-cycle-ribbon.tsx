'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, CalendarClock, CircleDot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Skeleton, cn } from '@erp/ui';
import type {
  CommercialCurrentCycleResponse,
  CommercialCycleStage,
  CommercialPaymentScheduleInstallment,
} from '@erp/types';

import { useCommercialCurrentCycle } from '../hooks/use-commercial';
import { dueStatus } from '../presentation';

/**
 * The persistent cycle ribbon (ADR-030 CONST-COM-025, S-SH-2).
 *
 * A single compact, sticky band mounted ABOVE the Commercial view switch, so it reads the same on
 * all four tabs: **state dot · stage · blocker (if any) · one action**. It supersedes the interim
 * `CurrentPaymentCycle` card C2 relocated onto Payment Schedule — the "what happens next to get
 * paid" cue now travels with the reader wherever they are in the workspace, instead of being
 * stranded on one tab.
 *
 * It renders the server's `getCurrentCycle` read model verbatim. The stage, the next action, and
 * the blockers are all the server's verdict — the browser re-derives none of them. When the NEXT
 * milestone installment is gated on an unverified programme milestone the server returns
 * `blockers: ['MILESTONE_NOT_VERIFIED']` and `nextAction: null`; the ribbon then states the reason
 * and offers a "Go verify" link into Programme & Progress, and shows the action disabled WITH that
 * reason beside it — never a bare disabled button (CONST-COM-025).
 *
 * Money is the server's too: a figure the caller's tier does not admit never appears as `$0`. The
 * ribbon carries no money content of its own (the position bands own that on Billing) — it is a
 * cue, not a dashboard.
 */
export function CommercialCycleRibbon({ projectId }: { projectId: string }) {
  const query = useCommercialCurrentCycle(projectId);

  // A slim skeleton band the same height as the resolved ribbon, so the tabs below never jump when
  // the cycle arrives.
  if (query.isPending) {
    return <Skeleton className="h-11 w-full rounded-panel" aria-hidden="true" />;
  }

  // The cycle is a cue, not the workspace's data. If it fails to load, stay silent rather than
  // pushing an error band across every tab — the tab's own content (and its own error handling)
  // still renders below. The summary query drives the real load/error state of the workspace.
  if (query.isError) return null;

  return <Ribbon projectId={projectId} cycle={query.data} />;
}

function Ribbon({
  projectId,
  cycle,
}: {
  projectId: string;
  cycle: CommercialCurrentCycleResponse;
}) {
  const t = useTranslations('commercial.cycle');
  const tSchedule = useTranslations('commercial.paymentSchedule');
  const isMilestone = cycle.stage === 'MILESTONE_SCHEDULE';

  const focus = isMilestone ? nextInstallment(cycle) : null;
  const blocked = cycle.blockers.includes('MILESTONE_NOT_VERIFIED');
  // The blocker's evidence is the NEXT installment's linked programme milestone.
  const gatedMilestone = blocked ? (focus?.programmeMilestone ?? null) : null;
  // A due-date cue for the NEXT stage — "due in 5 days" / "overdue" — so the ribbon prompts billing
  // before a stage slips, not only when it is already blocked. `upcoming` (>1 week) shows nothing.
  const due = focus ? dueStatus(focus.dueDate) : null;
  const showDue = due !== null && due.key !== 'upcoming';

  return (
    <section
      // Sticky like a frozen header (the BOQ money strip's grammar). The logical leading border
      // carries the state colour so one glance reads "clear" vs "blocked" without reading the text.
      className={cn(
        'sticky top-0 z-20 rounded-panel border border-s-4 bg-surface shadow-e1',
        blocked ? 'border-s-warning border-border' : 'border-s-brand-primary border-border',
      )}
      aria-label={t('ribbon.label')}
    >
      <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {/* State dot + the plain-language stage. */}
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 text-body-sm font-semibold',
              blocked ? 'text-warning' : 'text-brand-primary',
            )}
          >
            {blocked ? (
              <AlertTriangle size={15} aria-hidden="true" />
            ) : (
              <CircleDot size={15} aria-hidden="true" />
            )}
            <StageLabel cycle={cycle} focus={focus} isMilestone={isMilestone} t={t} />
          </span>

          {/* The due-date cue for the NEXT stage, inline after the stage. */}
          {showDue && due ? (
            <>
              <Dot />
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 text-caption font-medium',
                  due.tone === 'danger' ? 'text-danger' : 'text-warning',
                )}
              >
                <CalendarClock size={12} aria-hidden="true" />
                {tSchedule(`due.${due.key}`, { days: Math.abs(due.days) })}
              </span>
            </>
          ) : null}

          {/* The blocker reason, inline, with a link to go clear it. */}
          {blocked ? (
            <>
              <Dot />
              <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-warning">
                <span className="min-w-0">
                  {gatedMilestone
                    ? t('ribbon.blockedNamed', { name: gatedMilestone.name })
                    : t('ribbon.blocked')}
                </span>
                <Link
                  href={`/projects/${projectId}/progress`}
                  className="inline-flex shrink-0 items-center gap-0.5 font-medium text-warning underline underline-offset-2 hover:text-warning/80"
                >
                  {t('ribbon.goVerify')}
                  <ArrowRight size={12} aria-hidden="true" />
                </Link>
              </span>
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center lg:justify-end">
          <CycleAction cycle={cycle} blocked={blocked} projectId={projectId} t={t} />
        </div>
      </div>
    </section>
  );
}

/**
 * The plain-language stage label. For a MILESTONE contract it enriches the base stage with
 * "Milestone N of M · <name>" from the NEXT installment where the schedule is available, reusing
 * the existing `stageTitle` labels for every other stage so the ribbon and the old cycle card
 * speak the same vocabulary.
 */
function StageLabel({
  cycle,
  focus,
  isMilestone,
  t,
}: {
  cycle: CommercialCurrentCycleResponse;
  focus: CommercialPaymentScheduleInstallment | null;
  isMilestone: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (isMilestone && focus) {
    const installments = cycle.paymentSchedule?.installments ?? [];
    const position = installments.findIndex((i) => i.id === focus.id) + 1;
    return (
      <span className="min-w-0">
        {t('ribbon.milestoneStage', {
          n: position,
          total: installments.length,
          name: focus.name,
        })}
      </span>
    );
  }
  return <span className="min-w-0">{t(`stageTitle.${cycle.stage}` as const)}</span>;
}

/**
 * The one action.
 *
 * A present `nextAction` is the primary button — its `href` and `kind` verbatim. When the server
 * withheld the action because of the milestone gate (`nextAction: null` with the
 * `MILESTONE_NOT_VERIFIED` blocker), the button is shown DISABLED with the reason already stated
 * inline to its side — never a bare disabled control (CONST-COM-025). When all installments are
 * invoiced, a "Go to Billing & Collection" link guides the operator to track payments. When there
 * is nothing else to do, no button is shown.
 */
function CycleAction({
  cycle,
  blocked,
  projectId,
  t,
}: {
  cycle: CommercialCurrentCycleResponse;
  blocked: boolean;
  projectId: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (cycle.nextAction) {
    return (
      <Button asChild size="sm" className="min-h-11 sm:min-h-0">
        <Link href={cycle.nextAction.href}>{t(`actions.${cycle.nextAction.kind}`)}</Link>
      </Button>
    );
  }

  // No action AND a milestone gate: the reason lives inline in the ribbon body, so this is the
  // disabled-with-reason pair CONST-COM-025 requires, not a bare disabled button.
  if (blocked) return null;

  // When MILESTONE_SCHEDULE with no next action and no blocker, all installments are invoiced.
  // Guide the operator toward collection rather than leaving the ribbon with no affordance.
  if (cycle.stage === 'MILESTONE_SCHEDULE') {
    return (
      <Button asChild variant="ghost" size="sm" className="min-h-11 sm:min-h-0">
        <Link href={`/projects/${projectId}/commercial/billing-collection`}>
          {t('allBilledBanner.goToCollections')}
        </Link>
      </Button>
    );
  }

  return null;
}

/** The first un-invoiced installment — where billing legitimately happens (the server's NEXT). */
function nextInstallment(
  cycle: CommercialCurrentCycleResponse,
): CommercialPaymentScheduleInstallment | null {
  return cycle.paymentSchedule?.installments.find((i) => i.status === 'NEXT') ?? null;
}

/** Middot separator between the stage and the blocker reason. */
function Dot() {
  return (
    <span className="shrink-0 text-border-strong" aria-hidden="true">
      ·
    </span>
  );
}

// Re-exported so a caller can type against the stage without re-importing @erp/types.
export type { CommercialCycleStage };
