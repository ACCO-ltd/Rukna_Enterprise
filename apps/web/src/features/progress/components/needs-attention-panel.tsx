'use client';

import { useTranslations } from 'next-intl';
import { Badge, RecordPanel } from '@erp/ui';
import { AlertCircle, ChevronRight } from 'lucide-react';

import { useBoqLeaves } from '../hooks/use-boq-leaves';
import { useDprs, useProjectRollup, useWorkPackages } from '../hooks/use-progress';
import type { ProgressView } from './progress-tab';

interface AttentionItem {
  id: string;
  count: number;
  title: string;
  hint: string;
  goTo: ProgressView;
}

/**
 * What is actually standing in the way, and nothing else.
 *
 * Every item here is derived from data the server already returns, and every one is something a
 * person can go and fix:
 *
 *  - reports sitting in SUBMITTED contribute nothing to progress until somebody approves them;
 *  - weights below 100% mean the project figure is understating itself by construction;
 *  - an unallocated billable BOQ item belongs to no work package, so its progress rolls up nowhere.
 *
 * Deliberately absent: "N work packages have no update this period" and "N work packages behind
 * plan by more than X" — both appear in the reference design and neither is grounded. There is no
 * period model to have "this period" mean anything, and no per-package baseline to be behind. An
 * attention queue that invents its own thresholds is worse than a short one.
 */
export function NeedsAttentionPanel({
  projectId,
  onGoTo,
}: {
  projectId: string;
  onGoTo: (view: ProgressView) => void;
}) {
  const t = useTranslations('progress');
  const dprs = useDprs(projectId);
  const rollup = useProjectRollup(projectId);
  const workPackages = useWorkPackages(projectId);
  const leaves = useBoqLeaves(projectId);

  const items: AttentionItem[] = [];

  const pending = dprs.data?.filter((d) => d.status === 'SUBMITTED').length ?? 0;
  if (pending > 0) {
    items.push({
      id: 'pending',
      count: pending,
      title: t('attention.pendingVerification', { count: pending }),
      hint: t('attention.pendingVerificationHint'),
      goTo: 'verification',
    });
  }

  // Only worth raising once there is a model to be incomplete — a project with no work packages
  // is being set up, and the setup checklist already says so.
  const hasPackages = (workPackages.data?.length ?? 0) > 0;
  if (hasPackages && rollup.data && !rollup.data.weightsComplete) {
    const total = `${Math.round(Number(rollup.data.weightsTotal) * 100)}%`;
    items.push({
      id: 'weights',
      count: 1,
      title: t('attention.weightsIncomplete', { total }),
      hint: t('attention.weightsIncompleteHint'),
      goTo: 'planSetup',
    });
  }

  // `leafCount` is all the roll-up reports per package, so the unallocated figure is the BOQ's
  // billable leaves minus everything the packages account for between them. Only meaningful once
  // a baseline exists — before that there are no leaves to allocate.
  const allocatedCount = (rollup.data?.packages ?? []).reduce((sum, p) => sum + p.leafCount, 0);
  const billableCount = leaves.leaves.length;
  const unallocated = billableCount - allocatedCount;
  if (hasPackages && leaves.hasBaseline && billableCount > 0 && unallocated > 0) {
    items.push({
      id: 'unallocated',
      count: unallocated,
      title: t('attention.unallocated', { count: unallocated }),
      hint: t('attention.unallocatedHint'),
      goTo: 'planSetup',
    });
  }
  const loading = dprs.isPending || rollup.isPending || workPackages.isPending;

  return (
    <RecordPanel
      title={t('attention.title')}
      icon={<AlertCircle size={17} strokeWidth={1.9} />}
      action={
        items.length > 0 ? (
          <Badge tone="warning">{items.reduce((sum, i) => sum + i.count, 0)}</Badge>
        ) : null
      }
      padded={items.length === 0}
    >
      {loading ? (
        <div className="h-16 animate-pulse rounded-control bg-muted" aria-hidden="true" />
      ) : items.length === 0 ? (
        <>
          <p className="text-body-sm font-medium text-foreground">{t('attention.clear')}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t('attention.clearHint')}</p>
        </>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onGoTo(item.goTo)}
                className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-primary"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-micro font-bold tabular-nums text-warning">
                  {item.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-caption text-muted-foreground">
                    {item.hint}
                  </span>
                </span>
                <ChevronRight
                  size={16}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-muted-foreground rtl:rotate-180"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </RecordPanel>
  );
}
