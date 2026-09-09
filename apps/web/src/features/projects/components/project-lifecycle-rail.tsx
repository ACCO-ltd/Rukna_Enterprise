'use client';

import { useTranslations } from 'next-intl';
import { ProjectStatus } from '@erp/types';
import { cn } from '@erp/ui';
import { Check } from 'lucide-react';

const LIFECYCLE_STAGES: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.ACTIVE,
  ProjectStatus.PRACTICAL_COMPLETION,
  ProjectStatus.CLOSEOUT,
  ProjectStatus.CLOSED,
];

/**
 * Where the project stands in its life, as one row of dots and connectors.
 *
 * This used to render in the workspace header above every tab, which meant seven working
 * screens paid a row of vertical space to be told something their reader already knew. It is
 * project-level context, so it belongs on the tab that exists to carry project-level context.
 *
 * There is deliberately no "View history" control. Lifecycle history has no endpoint — the
 * only project history the API returns is the five-event activity feed already on this page —
 * and a control that advertises an unbuilt feature earns a support question on every visit
 * (`ux-doctrine.md` §4).
 *
 * A cancelled project renders nothing: it left the rail rather than reaching a point on it,
 * and the status badge in the header already says so.
 */
export function ProjectLifecycleRail({ status }: { status: ProjectStatus }) {
  const t = useTranslations('platform.projects');
  const tDetail = useTranslations('platform.projects.detail');
  const current = LIFECYCLE_STAGES.indexOf(status);

  if (current < 0) return null;

  return (
    <section className="border-b border-border pb-4">
      {/* Scrolls rather than wraps on a narrow screen: a stepper that wraps stops reading as
          a sequence, and this one row serves 375px too. */}
      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
        {/* Green for stages already passed, blue for the one in progress, grey for the rest.
            The whole strip used to be brand blue up to the current stage, which meant the
            colour said "brand" rather than "done" — and blue is the interactive colour
            everywhere else in the product. See the semantics table in frontend-theme.md. */}
        <ol aria-label={tDetail('lifecycle')} className="flex min-w-max items-center gap-2">
          {LIFECYCLE_STAGES.map((stage, index) => {
            const complete = index < current;
            const active = index === current;
            const label = t(`status.${stage}`);

            return (
              <li key={stage} className="flex shrink-0 items-center gap-2">
                <div
                  className="flex items-center gap-1.5"
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                      active && 'bg-foreground',
                      complete && 'bg-success',
                      !complete && !active && 'border border-border/70 bg-surface',
                    )}
                  >
                    {complete ? (
                      <Check size={10} strokeWidth={3} className="text-white" aria-hidden="true" />
                    ) : null}
                    {active ? (
                      <span className="h-1 w-1 rounded-full bg-white" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'whitespace-nowrap text-caption font-medium leading-none',
                      active && 'font-semibold text-foreground',
                      complete && 'text-success',
                      // What has not happened yet is the quietest thing on the rail. It used to
                      // sit at full muted-foreground, which put five equally-weighted labels in
                      // a row under the tab bar and read as a second navigation strip.
                      !complete && !active && 'text-muted-foreground/70',
                    )}
                  >
                    {label}
                  </span>
                </div>
                {index < LIFECYCLE_STAGES.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-px w-5 shrink-0 lg:w-8',
                      // The connector belongs to the stage behind it: green once passed. Both
                      // states are drawn back from full strength — the connectors are joinery,
                      // and at full weight they were the loudest thing in the section.
                      complete ? 'bg-success/40' : 'bg-border/60',
                    )}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
