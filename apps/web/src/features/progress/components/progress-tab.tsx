'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ViewSwitcher } from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { WorkspaceSectionHeader } from '@/components/layout/workspace-section-header';

import { TodaySection } from './today-section';
import { ReviewSection } from './review-section';
import { PerformanceView, PlanView } from './programme-section';

/**
 * Four views (flow plan PR 5). Programme used to be one very long page mixing what the numbers
 * say with how the plan is set up, and listed work packages twice; it is now Performance
 * (read) and Plan & setup (configure).
 */
export type ProgressView = 'today' | 'review' | 'performance' | 'plan';

/**
 * Programme & Progress workspace — four role-aware views (ADR-021, ADR-022, flow plan PR 5).
 *
 *  Today        — SE's primary entry point: today's DPR state + recent reports
 *  Review       — PM's primary entry point: DPR approval queue + returns
 *  Performance  — read-only: S-curve, needs attention, work-package and verified progress
 *  Plan & setup — work packages, baseline, milestones, master schedule, activities
 *
 * Default tab: if the user holds `approve:progress` (PM) → Review; otherwise → Today.
 * Setup actions (create work package, approve baseline) are gated on `manage:project` inside
 * each component. A compact setup notice on Performance and Plan replaces the old checklist.
 */
export function ProgressTab({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const { can } = usePermissions();

  const defaultView: ProgressView = can('approve:progress') ? 'review' : 'today';
  const [view, setView] = useState<ProgressView>(defaultView);

  return (
    <div className="space-y-6">
      <WorkspaceSectionHeader title={t('title')} description={t('subtitle')} />

      {/* Same look as WorkspaceSubNav (text-only underline). Button mode: these views are
          component state, not routes — the flow plan's PR 5 restructures Progress. */}
      <ViewSwitcher
        appearance="underline"
        aria-label={t('tabs.label')}
        value={view}
        onValueChange={(next) => setView(next as ProgressView)}
        items={[
          { value: 'today', label: t('tabs.today') },
          { value: 'review', label: t('tabs.review') },
          { value: 'performance', label: t('tabs.performance') },
          { value: 'plan', label: t('tabs.plan') },
        ]}
      />

      <div>
        {view === 'today' && <TodaySection projectId={projectId} />}
        {view === 'review' && <ReviewSection projectId={projectId} />}
        {view === 'performance' && <PerformanceView projectId={projectId} onGoTo={setView} />}
        {view === 'plan' && <PlanView projectId={projectId} />}
      </div>
    </div>
  );
}
