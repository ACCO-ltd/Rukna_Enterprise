'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ViewSwitcher } from '@erp/ui';

import { MilestonesSection } from '@/features/programme/components/milestones-section';

import { DailyReportsSection } from './daily-reports-section';
import { VerifiedProgressSection } from './verified-progress-section';
import { WorkPackagesSection } from './work-packages-section';
import { PerformanceSection } from './performance-section';

type ProgressView = 'reports' | 'workPackages' | 'verified' | 'milestones' | 'performance';

/**
 * Programme & Progress workspace tab (ADR-021).
 *
 * Four separated truths, one surface: the daily site record (DPRs), the work-package control
 * layer, verified physical progress, programme milestones, and the physical-vs-financial signal.
 *
 * The five sub-views are a *level-3 local view switch* (ux-doctrine §5): this whole tab is the
 * level-2 module tab, so the sub-views use the quiet segmented `ViewSwitcher` — NOT another
 * underline `Tabs`, which would read as a second global tab bar. The active view is client-side
 * state; the whole tab lives under one `/progress` route. Order follows the operational flow:
 * record the day → control it against work packages → read verified progress → check milestones
 * → watch the physical-vs-financial signal.
 */
export function ProgressTab({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const [view, setView] = useState<ProgressView>('reports');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ViewSwitcher
        aria-label={t('tabs.label')}
        value={view}
        onValueChange={(next) => setView(next as ProgressView)}
        items={[
          { value: 'reports', label: t('tabs.reports') },
          { value: 'workPackages', label: t('tabs.workPackages') },
          { value: 'verified', label: t('tabs.verified') },
          { value: 'milestones', label: t('tabs.milestones') },
          { value: 'performance', label: t('tabs.performance') },
        ]}
      />

      <div>
        {view === 'reports' ? <DailyReportsSection projectId={projectId} /> : null}
        {view === 'workPackages' ? <WorkPackagesSection projectId={projectId} /> : null}
        {view === 'verified' ? <VerifiedProgressSection projectId={projectId} /> : null}
        {view === 'milestones' ? <MilestonesSection projectId={projectId} /> : null}
        {view === 'performance' ? <PerformanceSection projectId={projectId} /> : null}
      </div>
    </div>
  );
}
