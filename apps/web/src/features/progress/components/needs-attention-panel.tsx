'use client';

import { useTranslations } from 'next-intl';
import { AlertCircle, ChevronRight } from 'lucide-react';

import { useBoqLeaves } from '../hooks/use-boq-leaves';
import { useDprs, useProjectRollup, useWorkPackages } from '../hooks/use-progress';
import type { ProgressView } from './progress-tab';
import { RefCard, RefCardBody, RefCardHeader, RefPill } from './ref-ui';

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
      goTo: 'review',
    });
  }

  const hasPackages = (workPackages.data?.length ?? 0) > 0;
  if (hasPackages && rollup.data && !rollup.data.weightsComplete) {
    const total = `${Math.round(Number(rollup.data.weightsTotal) * 100)}%`;
    items.push({
      id: 'weights',
      count: 1,
      title: t('attention.weightsIncomplete', { total }),
      hint: t('attention.weightsIncompleteHint'),
      goTo: 'programme',
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
      goTo: 'programme',
    });
  }
  const loading = dprs.isPending || rollup.isPending || workPackages.isPending;

  // A project with no work packages yet isn't "clear" — it's unset up, and the Programme view's
  // own setup notice (above this panel, same page) already says so. Rendering "Nothing needs
  // attention" here at the same time would flatly contradict it, so this panel stays silent
  // rather than repeat or dispute that message.
  if (!loading && !hasPackages) return null;

  return (
    <RefCard>
      <RefCardHeader
        icon={<AlertCircle size={17} strokeWidth={1.9} />}
        iconTone={items.length > 0 ? 'amber' : 'blue'}
        title={t('attention.title')}
        divider
        action={
          items.length > 0 ? (
            <RefPill tone="amber">{items.reduce((sum, i) => sum + i.count, 0)}</RefPill>
          ) : null
        }
      />
      {loading ? (
        <RefCardBody className="pt-4">
          <div className="h-16 animate-pulse rounded-lg bg-gray-100" aria-hidden="true" />
        </RefCardBody>
      ) : items.length === 0 ? (
        <RefCardBody className="pt-4">
          <p className="text-sm font-medium text-gray-900">{t('attention.clear')}</p>
          <p className="mt-1 text-xs text-gray-500">{t('attention.clearHint')}</p>
        </RefCardBody>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onGoTo(item.goTo)}
                className="flex w-full items-start gap-3 px-5 py-3 text-start transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold tabular-nums text-amber-700">
                  {item.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">{item.title}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{item.hint}</span>
                </span>
                <ChevronRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400 rtl:rotate-180" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </RefCard>
  );
}
