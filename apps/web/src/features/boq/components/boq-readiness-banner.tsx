'use client';

import { useMemo, useState } from 'react';
import type { BoqBaselineReadinessResponse, BoqReadinessBlockerKind } from '@erp/types';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

/**
 * Why this BOQ cannot be baselined yet, and what to press about it.
 *
 * Three things changed after the first pass:
 *
 * 1. **It no longer repeats itself.** It used to carry "5 items require attention", then
 *    "5 items missing rate", then a "Review 5 blockers" button — the number three times —
 *    plus a "Pricing complete: 38 of 43" eyebrow restating what the status bar says 100px
 *    above. The specific line is now the headline, and it says why it matters.
 *
 * 2. **It is not dismissible while it owns the only next step.** A banner carrying the
 *    single actionable control on the page, with an ✕ beside it, is how a screen becomes
 *    actionless. The ✕ returns once the version is ready, where it really is confirmation.
 *
 * 3. **Each kind is individually actionable.** One bulk "review" button made the user
 *    filter to everything at once; "Show these" per group means missing rates and duplicate
 *    codes are separate pieces of work, because they are.
 */
export function BoqReadinessBanner({
  readiness,
  onShowNodes,
  dismissible,
}: {
  readiness: BoqBaselineReadinessResponse;
  /** Filters the grid to these rows. */
  onShowNodes: (nodeIds: string[]) => void;
  /** False while this banner carries the page's next action. */
  dismissible: boolean;
}) {
  const t = useTranslations('platform.boq.readiness');
  const [dismissed, setDismissed] = useState(false);

  // One blocker per missing field means an item with no unit, quantity or rate produces
  // three. Group by kind and count distinct rows, so "5 items missing a rate" is true.
  const groups = useMemo(() => {
    const byKind = new Map<BoqReadinessBlockerKind, Set<string>>();
    for (const blocker of readiness.blockers) {
      const bucket = byKind.get(blocker.kind) ?? new Set<string>();
      if (blocker.nodeId) bucket.add(blocker.nodeId);
      byKind.set(blocker.kind, bucket);
    }
    return [...byKind.entries()].map(([kind, ids]) => ({
      kind,
      nodeIds: [...ids],
      count: ids.size || 1,
    }));
  }, [readiness.blockers]);

  if (readiness.ready) {
    if (dismissed) return null;
    return (
      <section
        aria-labelledby="boq-readiness-heading"
        className="flex items-start justify-between gap-3 rounded-panel border border-success/25 bg-success-subtle px-4 py-3 sm:px-5"
      >
        <div className="flex items-start gap-2.5">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <div>
            <h2 id="boq-readiness-heading" className="text-body-sm font-semibold text-foreground">
              {t('ready')}
            </h2>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('readyHint', { items: readiness.itemCount })}
            </p>
          </div>
        </div>
        <DismissButton label={t('dismiss')} onClick={() => setDismissed(true)} />
      </section>
    );
  }

  // One kind of problem is the common case by far — a surveyor part-way through pricing.
  // Rendering a heading, then a list of one, then a link, spends three rows and ~90px of
  // the space that should be showing BOQ rows, to say a single sentence.
  const single = groups.length === 1 ? groups[0]! : null;

  return (
    <section
      aria-labelledby="boq-readiness-heading"
      className="rounded-panel border border-warning/30 bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="boq-readiness-heading" className="text-body-sm font-semibold text-foreground">
              {headline(groups, readiness, t)}
            </h2>
            {/* Says what the blockage costs, not just that it exists. An unpriced line is
                not a tidiness problem — nothing can be certified or invoiced against it. */}
            <p className="mt-0.5 text-caption text-muted-foreground">{t('consequence')}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {single && single.nodeIds.length > 0 ? (
            <ShowTheseButton label={t('showThese')} onClick={() => onShowNodes(single.nodeIds)} />
          ) : null}
          {dismissible ? (
            <DismissButton label={t('dismiss')} onClick={() => setDismissed(true)} />
          ) : null}
        </div>
      </div>

      {/* Several kinds of problem are several pieces of work, so each gets its own row and
          its own way in. One bulk "review" button filtered to all of them at once. */}
      {single === null ? (
        <ul className="divide-y divide-border/70 border-t border-border">
          {groups.map((group) => (
            <li
              key={group.kind}
              className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5"
            >
              <span className="flex min-w-0 items-center gap-2 text-caption text-foreground">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                {t(`kind.${group.kind}`, { count: group.count })}
              </span>
              {group.nodeIds.length > 0 ? (
                <ShowTheseButton
                  label={t('showThese')}
                  onClick={() => onShowNodes(group.nodeIds)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ShowTheseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-caption font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
    >
      {label}
    </button>
  );
}

/**
 * One sentence naming the dominant problem, rather than a generic count.
 *
 * "5 items need a rate before this BOQ can be baselined" tells a surveyor what to do.
 * "5 items require attention" tells them to go looking.
 */
function headline(
  groups: { kind: BoqReadinessBlockerKind; count: number }[],
  readiness: BoqBaselineReadinessResponse,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (groups.length === 0) return t('blockedGeneric');
  if (groups.length === 1) return t(`headline.${groups[0]!.kind}`, { count: groups[0]!.count });

  const rows = new Set<string>();
  for (const group of groups) rows.add(group.kind);
  return t('headlineMixed', {
    count: readiness.incompleteItemCount + readiness.duplicateCodeCount || rows.size,
  });
}

function DismissButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground',
        'transition-colors hover:bg-surface-subtle hover:text-foreground',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
      )}
    >
      <X size={15} aria-hidden="true" />
    </button>
  );
}
