'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { MilestonesSection } from '@/features/programme/components/milestones-section';
import { WorkPackageScheduleSection } from '@/features/programme/components/work-package-schedule-section';
import { ActivitiesSection } from '@/features/programme/components/activities-section';
import { ScheduleSetupCard } from '@/features/programme/components/schedule-setup-card';
import { DownloadMasterScheduleButton } from '@/features/programme/components/download-master-schedule-button';

import { useProjectRollup, useWorkPackages } from '../hooks/use-progress';
import type { ProgressView } from './progress-tab';
import { PerformanceSection } from './performance-section';
import { VerifiedProgressSection } from './verified-progress-section';
import { WorkPackagesSection } from './work-packages-section';
import { BaselineSection } from './baseline-section';

/**
 * Programme view — the PM's configuration and planning hub.
 *
 * Consolidates what was previously split across "Plan & Setup" and "Schedule" tabs:
 * performance metrics, verified progress breakdown, work packages, baseline, milestones,
 * WP schedule timeline, and activities — in one scrollable view.
 *
 * A compact setup notice appears at the top when the project is not yet configured,
 * pointing to the relevant subsection below rather than blocking the entire tab.
 */
export function ProgrammeSection({
  projectId,
  onGoTo,
}: {
  projectId: string;
  onGoTo: (view: ProgressView) => void;
}) {
  const t = useTranslations('progress');
  const rollup = useProjectRollup(projectId);
  const workPackages = useWorkPackages(projectId);

  const hasPackages = (workPackages.data?.length ?? 0) > 0;
  const hasAllocation = (rollup.data?.packages ?? []).some((p) => p.leafCount > 0);
  const weightsComplete = rollup.data?.weightsComplete ?? false;
  const modelReady = hasPackages && hasAllocation && weightsComplete;

  const setupStep = !hasPackages
    ? 'workPackages'
    : !hasAllocation
      ? 'allocate'
      : !weightsComplete
        ? 'weights'
        : null;

  function scrollToWorkPackages() {
    document.getElementById('progress-section-work-packages')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  return (
    <div className="space-y-8">
      {!modelReady && setupStep && (
        <SetupNotice step={setupStep} t={t} onAction={scrollToWorkPackages} />
      )}

      <PerformanceSection projectId={projectId} onGoTo={onGoTo} />

      <VerifiedProgressSection projectId={projectId} />

      <div id="progress-section-work-packages">
        <WorkPackagesSection projectId={projectId} />
      </div>

      <BaselineSection projectId={projectId} />

      <MilestonesSection projectId={projectId} />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t('tabs.programme')}</h3>
        <DownloadMasterScheduleButton projectId={projectId} />
      </div>

      <ScheduleSetupCard projectId={projectId} />

      <WorkPackageScheduleSection projectId={projectId} />

      <ActivitiesSection projectId={projectId} />
    </div>
  );
}

function SetupNotice({
  step,
  t,
  onAction,
}: {
  step: 'workPackages' | 'allocate' | 'weights';
  t: ReturnType<typeof useTranslations<'progress'>>;
  onAction: () => void;
}) {
  const messages: Record<typeof step, string> = {
    workPackages: t('setup.workPackages.description'),
    allocate: t('setup.allocate.description'),
    weights: t('rollup.unavailable'),
  };

  const actions: Record<typeof step, string> = {
    workPackages: t('setup.workPackages.action'),
    allocate: t('setup.allocate.action'),
    weights: t('setup.weights.action'),
  };

  return (
    <Alert variant="info" messages={[messages[step]]}>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={onAction}>
          {actions[step]}
        </Button>
      </div>
    </Alert>
  );
}
