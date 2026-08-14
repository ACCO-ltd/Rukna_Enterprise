'use client';

import { useMemo, useState } from 'react';
import type { BoqBaselineReadinessResponse, BoqReadinessBlockerKind } from '@erp/types';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@erp/ui';

/**
 * Baseline readiness, as the server evaluated it.
 *
 * Nothing here is computed locally. The same policy answers `GET …/readiness` and refuses
 * `POST …/baseline`, so what this banner says and what the button will do cannot diverge —
 * which they did before ADR-016, when the screen decided whether to offer the command and
 * the server decided whether to honour it.
 *
 * Shaped after `WorkspaceGuidancePanel` in `project-detail.tsx`: an out-of-card eyebrow row
 * whose icon colour carries the state, then a `divide-y` panel.
 */
export function BoqReadinessBanner({
  readiness,
  onReviewBlockers,
  showClearState,
}: {
  readiness: BoqBaselineReadinessResponse;
  /** Filters the grid down to the blocking rows. */
  onReviewBlockers: (nodeIds: string[]) => void;
  /** Suppressed on a read-only baselined version, where "ready" is not news. */
  showClearState: boolean;
}) {
  const t = useTranslations('platform.boq.readiness');
  const [dismissed, setDismissed] = useState(false);

  // Blockers arrive one per node per missing field. A reader wants "9 items missing a rate",
  // not 9 separate lines, so group by kind and keep the node ids for the filter.
  const grouped = useMemo(() => {
    const groups = new Map<BoqReadinessBlockerKind, string[]>();
    for (const blocker of readiness.blockers) {
      const bucket = groups.get(blocker.kind) ?? [];
      if (blocker.nodeId) bucket.push(blocker.nodeId);
      groups.set(blocker.kind, bucket);
    }
    return [...groups.entries()];
  }, [readiness.blockers]);

  const blockedNodeIds = useMemo(
    () =>
      [...new Set(readiness.blockers.map((blocker) => blocker.nodeId).filter(Boolean))] as string[],
    [readiness.blockers],
  );

  if (readiness.ready) {
    if (!showClearState) return null;
    return (
      <section
        aria-labelledby="boq-readiness-heading"
        className="rounded-panel border border-success/20 bg-success/5 px-5 py-4"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 size={17} className="text-success" aria-hidden="true" />
          <h2 id="boq-readiness-heading" className="text-body-sm font-semibold text-foreground">
            {t('ready')}
          </h2>
        </div>
        <p className="mt-1 text-caption text-muted-foreground">
          {t('readyHint', { items: readiness.itemCount })}
        </p>
      </section>
    );
  }

  if (dismissed) return null;

  return (
    <section aria-labelledby="boq-readiness-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={17} className="text-warning" aria-hidden="true" />
          <h2
            id="boq-readiness-heading"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {t('heading')}
          </h2>
        </div>
        <span className="text-caption text-muted-foreground">
          {t('completeness', {
            priced: readiness.pricedItemCount,
            total: readiness.itemCount,
          })}
        </span>
      </div>

      <div className="rounded-panel border border-warning/25 bg-surface shadow-e1">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="text-body-sm font-semibold text-foreground">
              {t('title', { count: readiness.blockers.length })}
            </p>
            <ul className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {grouped.map(([kind, nodeIds]) => (
                <li key={kind} className="text-caption text-muted-foreground">
                  <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warning align-middle" />
                  {t(`kind.${kind}`, { count: nodeIds.length || 1 })}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {blockedNodeIds.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReviewBlockers(blockedNodeIds)}
              >
                {t('review', { count: blockedNodeIds.length })}
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label={t('dismiss')}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-control text-muted-foreground',
                'transition-colors hover:bg-surface-subtle hover:text-foreground',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
              )}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
