'use client';

import { useTranslations } from 'next-intl';
import { Button, Skeleton } from '@erp/ui';

import { SetupChecklist, type ChecklistItem } from '@/components/setup-checklist';

import { useProjectRollup, useWorkPackages } from '../hooks/use-progress';
import { ProgressHeadline } from './progress-headline';
import type { ProgressView } from './progress-tab';

/**
 * The top of the Progress tab: either the answer (headline band) or, before the project is set up
 * to produce one, a guided setup checklist. A project can't roll a physical figure up until it has
 * work packages with allocated BOQ items — so rather than show four em-dash tiles, we show the
 * sequence that makes them real. Once structure exists the band takes over (progress may still be
 * 0% — that's an honest figure, not an unconfigured one).
 */
export function ProgressOverviewHeader({
  projectId,
  onGoTo,
}: {
  projectId: string;
  onGoTo: (view: ProgressView) => void;
}) {
  const t = useTranslations('progress');
  const rollup = useProjectRollup(projectId);
  const workPackages = useWorkPackages(projectId);

  if (rollup.isPending || workPackages.isPending) {
    return <Skeleton className="h-24 w-full" aria-hidden="true" />;
  }

  const packages = rollup.data?.packages ?? [];
  const hasPackages = (workPackages.data?.length ?? 0) > 0;
  const hasAllocation = packages.some((p) => p.leafCount > 0);
  const weightsComplete = rollup.data?.weightsComplete ?? false;

  // A meaningful figure needs at least one work package with allocated BOQ items.
  if (hasPackages && hasAllocation) {
    return <ProgressHeadline projectId={projectId} />;
  }

  const items: ChecklistItem[] = [
    {
      id: 'work-packages',
      label: t('setup.workPackages.label'),
      description: t('setup.workPackages.description'),
      status: hasPackages ? 'complete' : 'incomplete',
      action: hasPackages ? undefined : (
        <Button size="sm" variant="outline" onClick={() => onGoTo('planSetup')}>
          {t('setup.workPackages.action')}
        </Button>
      ),
    },
    {
      id: 'allocate',
      label: t('setup.allocate.label'),
      description: t('setup.allocate.description'),
      status: hasAllocation ? 'complete' : hasPackages ? 'incomplete' : 'blocked',
      blockedReason: hasPackages ? undefined : t('setup.allocate.blocked'),
      action:
        hasPackages && !hasAllocation ? (
          <Button size="sm" variant="outline" onClick={() => onGoTo('planSetup')}>
            {t('setup.allocate.action')}
          </Button>
        ) : undefined,
    },
    {
      id: 'weights',
      label: t('setup.weights.label'),
      description: weightsComplete
        ? undefined
        : t('rollup.weightsIncomplete', { total: rollup.data?.weightsTotal ?? '0' }),
      status: weightsComplete ? 'complete' : hasPackages ? 'incomplete' : 'blocked',
      blockedReason: hasPackages ? undefined : t('setup.weights.blocked'),
    },
    {
      id: 'baseline',
      label: t('setup.baseline.label'),
      description: t('setup.baseline.description'),
      status: 'optional',
    },
  ];

  const done = items.filter((i) => i.status === 'complete').length;
  const total = items.filter((i) => i.status !== 'optional').length;

  return (
    <SetupChecklist
      title={t('setup.title')}
      progress={t('setup.progress', { done, total })}
      items={items}
    />
  );
}
