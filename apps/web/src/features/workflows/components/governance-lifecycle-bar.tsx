'use client';

import { useTranslations } from 'next-intl';

import type { ApprovalPolicySummary } from '../api/workflows-api';

/**
 * The policy lifecycle as a dots-and-connector bar (Design DNA #7): the five governed stages
 * `Draft → In review → Scheduled → Active → Retired`, with the current stage filled and the
 * accent scarce (one filled dot). Past stages read `completed`, future stages `upcoming`.
 *
 * A RETIRED policy is a terminal end-cap — the whole line reads as spent, with the Retired
 * node marked as the current-but-terminal stage rather than a fifth waypoint yet to reach.
 *
 * This is presentation only; it renders inside the `RecordHeader` lifecycle slot and never
 * carries an action. The lifecycle *transitions* live in the header action cluster.
 *
 * SUPERSEDED (a version replaced by a newer active one) has no dedicated node — it is shown
 * as a terminal cap on the same line, reading as an ended version.
 */

const ORDER = ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'ACTIVE', 'RETIRED'] as const;

type LifecycleStage = (typeof ORDER)[number];

type StageState = 'completed' | 'current' | 'upcoming' | 'terminal';

export function GovernanceLifecycleBar({ status }: { status: ApprovalPolicySummary['status'] }) {
  const t = useTranslations('platform.workflows.policies.workspace');

  const labels: Record<LifecycleStage, string> = {
    DRAFT: t('stageDraft'),
    IN_REVIEW: t('stageInReview'),
    SCHEDULED: t('stageScheduled'),
    ACTIVE: t('stageActive'),
    RETIRED: t('stageRetired'),
  };

  // SUPERSEDED sits between ACTIVE and RETIRED in lifecycle terms — an ended version.
  // It is not one of the five nodes, so map it to the terminal end (Retired position).
  const currentIndex =
    status === 'SUPERSEDED' ? ORDER.indexOf('RETIRED') : ORDER.indexOf(status);
  const terminal = status === 'RETIRED' || status === 'SUPERSEDED';

  return (
    <ol
      aria-label={t('lifecycleLabel')}
      className="flex items-center gap-1 overflow-x-auto pb-0.5 text-caption"
    >
      {ORDER.map((stage, index) => {
        const state: StageState =
          index < currentIndex
            ? 'completed'
            : index === currentIndex
              ? terminal
                ? 'terminal'
                : 'current'
              : 'upcoming';
        const isLast = index === ORDER.length - 1;

        return (
          <li key={stage} className="flex shrink-0 items-center gap-1">
            <span className="flex items-center gap-1.5">
              <Dot state={state} />
              <span
                className={
                  state === 'upcoming'
                    ? 'whitespace-nowrap text-muted-foreground'
                    : state === 'terminal'
                      ? 'whitespace-nowrap font-medium text-danger'
                      : state === 'current'
                        ? 'whitespace-nowrap font-medium text-brand-primary'
                        : 'whitespace-nowrap text-foreground'
                }
              >
                {labels[stage]}
              </span>
            </span>
            {!isLast ? (
              <span
                aria-hidden="true"
                className={
                  index < currentIndex
                    ? 'h-px w-6 shrink-0 bg-brand-primary/40'
                    : 'h-px w-6 shrink-0 bg-border'
                }
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Dot({ state }: { state: StageState }) {
  const base = 'block h-2 w-2 shrink-0 rounded-full';
  if (state === 'completed') {
    return <span aria-hidden="true" className={`${base} bg-brand-primary/50`} />;
  }
  if (state === 'current') {
    return (
      <span
        aria-hidden="true"
        className={`${base} bg-brand-primary ring-2 ring-brand-primary/25`}
      />
    );
  }
  if (state === 'terminal') {
    return (
      <span aria-hidden="true" className={`${base} bg-danger ring-2 ring-danger/25`} />
    );
  }
  return <span aria-hidden="true" className={`${base} border border-border bg-surface`} />;
}
