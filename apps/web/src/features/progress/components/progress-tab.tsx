'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ViewSwitcher } from '@erp/ui';
import { CalendarDays, CircleCheck, Gauge, PenLine, Settings } from 'lucide-react';

import { MilestonesSection } from '@/features/programme/components/milestones-section';
import { ActivitiesSection } from '@/features/programme/components/activities-section';

import { DailyReportsSection } from './daily-reports-section';
import { VerifiedProgressSection } from './verified-progress-section';
import { WorkPackagesSection } from './work-packages-section';
import { PerformanceSection } from './performance-section';
import { ProgressOverviewHeader } from './progress-overview-header';
import { useProjectRollup } from '../hooks/use-progress';
import { BaselineSection } from './baseline-section';

export type ProgressView = 'overview' | 'record' | 'verification' | 'schedule' | 'planSetup';

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
  const rollup = useProjectRollup(projectId);
  const modelReady = Boolean(rollup.data?.weightsComplete && rollup.data.packages.some((item) => item.leafCount > 0));
  const [view, setView] = useState<ProgressView>('overview');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ProgressOverviewHeader projectId={projectId} onGoTo={setView} />

      {/* Underline, on the owner's instruction (2026-09-05), overriding ux-doctrine §5's
          "level-3 uses a segmented control". It sits directly under the project tab row, so it
          earns its separation instead from a shorter row, a lighter weight, and a glyph on the
          active tab only — which doubles as a non-colour signal of which view is current. */}
      <ViewSwitcher
        appearance="underline"
        aria-label={t('tabs.label')}
        value={view}
        onValueChange={(next) => setView(next as ProgressView)}
        items={[
          { value: 'overview', label: t('tabs.overview'), icon: <Gauge size={16} strokeWidth={1.9} /> },
          { value: 'record', label: t('tabs.record'), icon: <PenLine size={16} strokeWidth={1.9} /> },
          {
            value: 'verification',
            label: t('tabs.verification'),
            icon: <CircleCheck size={16} strokeWidth={1.9} />,
          },
          {
            value: 'schedule',
            label: t('tabs.schedule'),
            icon: <CalendarDays size={16} strokeWidth={1.9} />,
          },
          {
            value: 'planSetup',
            label: t('tabs.planSetup'),
            icon: <Settings size={16} strokeWidth={1.9} />,
          },
        ]}
      />

      <div>
        {view === 'overview' && modelReady ? (
          <PerformanceSection projectId={projectId} onGoTo={setView} />
        ) : null}
        {view === 'record' ? <DailyReportsSection projectId={projectId} /> : null}
        {view === 'verification' ? <VerifiedProgressSection projectId={projectId} /> : null}
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
