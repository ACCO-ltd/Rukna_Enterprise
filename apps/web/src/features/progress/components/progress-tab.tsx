'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ViewSwitcher } from '@erp/ui';

import { MilestonesSection } from '@/features/programme/components/milestones-section';
import { ActivitiesSection } from '@/features/programme/components/activities-section';

import { DailyReportsSection } from './daily-reports-section';
import { VerifiedProgressSection } from './verified-progress-section';
import { WorkPackagesSection } from './work-packages-section';
import { PerformanceSection } from './performance-section';
import { ProgressOverviewHeader } from './progress-overview-header';
import { BaselineSection } from './baseline-section';

export type ProgressView = 'performance' | 'record' | 'verified' | 'schedule' | 'planSetup';

/**
 * Programme & Progress workspace tab (ADR-021), refined to a reader-first layout
 * (see `docs/design/progress-workspace-refinement.md`).
 *
 * The tab opens with a persistent **headline band** answering "where are we vs plan, and can we
 * trust it?" (or a setup checklist before the project can produce that answer), then a level-3
 * `ViewSwitcher` over five reader-first views. The default is **Performance** — the answer — not
 * the daily-entry log, because most opens are to read, not record. Setup (work packages, weights,
 * allocation, baseline) is pulled out into its own **Plan & Setup** view so a reader never has to
 * understand the control model to read a number.
 *
 * Order: read the answer → record the day → read verified detail → check the schedule → set up.
 * The whole tab lives under one `/progress` route; the active view is client-side state.
 */
export function ProgressTab({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const [view, setView] = useState<ProgressView>('performance');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ProgressOverviewHeader projectId={projectId} onGoTo={setView} />

      <ViewSwitcher
        aria-label={t('tabs.label')}
        value={view}
        onValueChange={(next) => setView(next as ProgressView)}
        items={[
          { value: 'performance', label: t('tabs.performance') },
          { value: 'record', label: t('tabs.record') },
          { value: 'verified', label: t('tabs.verified') },
          { value: 'schedule', label: t('tabs.schedule') },
          { value: 'planSetup', label: t('tabs.planSetup') },
        ]}
      />

      <div>
        {view === 'performance' ? <PerformanceSection projectId={projectId} /> : null}
        {view === 'record' ? <DailyReportsSection projectId={projectId} /> : null}
        {view === 'verified' ? <VerifiedProgressSection projectId={projectId} /> : null}
        {view === 'schedule' ? (
          <div className="space-y-6">
            <MilestonesSection projectId={projectId} />
            <ActivitiesSection projectId={projectId} />
          </div>
        ) : null}
        {view === 'planSetup' ? (
          <div className="space-y-6">
            <WorkPackagesSection projectId={projectId} />
            <BaselineSection projectId={projectId} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
