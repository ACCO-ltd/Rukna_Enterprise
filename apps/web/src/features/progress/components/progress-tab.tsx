'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ViewSwitcher } from '@erp/ui';
import { CalendarDays, ClipboardCheck, PenLine } from 'lucide-react';

import { usePermissions } from '@/features/auth/permissions/can';

import { TodaySection } from './today-section';
import { ReviewSection } from './review-section';
import { ProgrammeSection } from './programme-section';

export type ProgressView = 'today' | 'review' | 'programme';

/**
 * Programme & Progress workspace — three role-aware views (ADR-021, ADR-022).
 *
 *  Today     — SE's primary entry point: today's DPR state + recent reports
 *  Review    — PM's primary entry point: DPR approval queue + returns
 *  Programme — Configuration and analytics: work packages, baseline, milestones,
 *              schedule timeline, activities, S-curve, verified progress
 *
 * Default tab: if the user holds `approve:progress` (PM) → Review; otherwise → Today.
 * Both roles can navigate to any tab they are permitted to read. Programme setup actions
 * (create work package, approve baseline) are gated on `manage:project` inside each component.
 *
 * The global setup checklist that previously blocked the tab header is removed.
 * A compact notice inside the Programme view replaces it.
 */
export function ProgressTab({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const { can } = usePermissions();

  const defaultView: ProgressView = can('approve:progress') ? 'review' : 'today';
  const [view, setView] = useState<ProgressView>(defaultView);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Underline nav — three views replacing the previous five */}
      <ViewSwitcher
        appearance="underline"
        aria-label={t('tabs.label')}
        value={view}
        onValueChange={(next) => setView(next as ProgressView)}
        items={[
          { value: 'today', label: t('tabs.today'), icon: <PenLine size={16} strokeWidth={1.9} /> },
          {
            value: 'review',
            label: t('tabs.review'),
            icon: <ClipboardCheck size={16} strokeWidth={1.9} />,
          },
          {
            value: 'programme',
            label: t('tabs.programme'),
            icon: <CalendarDays size={16} strokeWidth={1.9} />,
          },
        ]}
      />

      <div>
        {view === 'today' && <TodaySection projectId={projectId} />}
        {view === 'review' && <ReviewSection projectId={projectId} />}
        {view === 'programme' && <ProgrammeSection projectId={projectId} onGoTo={setView} />}
      </div>
    </div>
  );
}
