'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { MilestonesSection } from '@/features/programme/components/milestones-section';
import { WorkPackageScheduleSection } from '@/features/programme/components/work-package-schedule-section';
import { ActivitiesSection } from '@/features/programme/components/activities-section';
import { ScheduleSetupCard } from '@/features/programme/components/schedule-setup-card';
import { DownloadMasterScheduleButton } from '@/features/programme/components/download-master-schedule-button';

import { useProjectRollup, useWorkPackages } from '../hooks/use-progress';
import { progressViewHref } from '../domain/progress-views';
import { PerformanceSection } from './performance-section';
import { VerifiedProgressSection } from './verified-progress-section';
import { WorkPackagesSection } from './work-packages-section';
import { BaselineSection } from './baseline-section';

/** Whether the progress model (packages, allocation, weights) is set up, and the next step if not. */
function useSetupStep(projectId: string) {
  const rollup = useProjectRollup(projectId);
  const workPackages = useWorkPackages(projectId);

  const hasPackages = (workPackages.data?.length ?? 0) > 0;
  const hasAllocation = (rollup.data?.packages ?? []).some((p) => p.leafCount > 0);
  const weightsComplete = rollup.data?.weightsComplete ?? false;

  // Unknown is not "unset up": no notice until both answers are in, or it flashes on load.
  if (rollup.isPending || workPackages.isPending) return null;
  if (!hasPackages) return 'workPackages' as const;
  if (!hasAllocation) return 'allocate' as const;
  if (!weightsComplete) return 'weights' as const;
  return null;
}

/**
 * Performance — what the numbers say: the progress curve, what needs attention, work-package
 * progress and verified progress. Read-only; every "fix this" link goes to its own view's route.
 * The setup-incomplete state is handled by the view gate, not here.
 */
export function PerformanceView({ projectId }: { projectId: string }) {
  const router = useRouter();

  return (
    <div className="space-y-8">
      <PerformanceSection
        projectId={projectId}
        onGoTo={(view) => router.push(progressViewHref(projectId, view))}
      />
      <VerifiedProgressSection projectId={projectId} />
    </div>
  );
}

/**
 * Plan & setup — how the programme is built: work packages (the one editable list), the
 * planned baseline, milestones, the master schedule and activities.
 */
export function PlanView({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const setupStep = useSetupStep(projectId);

  function scrollToWorkPackages() {
    document.getElementById('progress-section-work-packages')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  return (
    <div className="space-y-8">
      {setupStep ? <SetupNotice step={setupStep} t={t} onAction={scrollToWorkPackages} /> : null}

      <div id="progress-section-work-packages">
        <WorkPackagesSection projectId={projectId} />
      </div>

      <BaselineSection projectId={projectId} />

      <MilestonesSection projectId={projectId} />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t('masterSchedule.title')}</h3>
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
