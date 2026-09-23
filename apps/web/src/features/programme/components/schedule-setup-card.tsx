'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@erp/ui';
import { CalendarClock } from 'lucide-react';

import { usePermissions } from '@/features/auth/permissions/can';
import { PROGRESS_PERMISSIONS } from '@/features/progress/permissions';
import { useBoqLeaves } from '@/features/progress/hooks/use-boq-leaves';
import { useProjectRollup } from '@/features/progress/hooks/use-progress';
import { RefButton } from '@/features/progress/components/ref-ui';

import { ScheduleSetupWizard } from './schedule-setup-wizard';

/**
 * Master Schedule P1-d (ADR-029) — the entry to the guided schedule builder, in Progress → Plan &
 * Setup, above the work-package table.
 *
 * States (spec §4.3), so the user is guided rather than dropped onto an empty grid:
 *  - No BOQ baseline → gated: the "Set up schedule" button is disabled with a hint (a schedule is
 *    built from BOQ scope).
 *  - No schedule yet (no phase carries planned dates) → a prominent CTA empty state, the primary
 *    affordance here — not a bare button.
 *  - A schedule exists → a compact "Edit schedule" affordance; the table below and the Schedule
 *    view carry the detail.
 *
 * Permission-gated on `manage:project` (the whole progress write chain uses it) — a reader never
 * sees a control the API would refuse.
 */
export function ScheduleSetupCard({ projectId }: { projectId: string }) {
  const tw = useTranslations('progress.scheduleWizard');
  const { can } = usePermissions();
  const { hasBaseline, isPending: baselinePending } = useBoqLeaves(projectId);
  const rollup = useProjectRollup(projectId);
  const [open, setOpen] = useState(false);

  // Honesty: no disabled stub for a user who cannot manage — the setup entry simply is not there.
  if (!can(PROGRESS_PERMISSIONS.manage)) return null;

  // Don't flash an empty state while the baseline/roll-up resolve.
  if (baselinePending || rollup.isPending) {
    return <div className="h-28 animate-pulse rounded-xl bg-gray-100" aria-hidden="true" />;
  }

  const packages = rollup.data?.packages ?? [];
  const hasSchedule = packages.some((p) => p.plannedStart && p.plannedEnd);

  const wizard = (
    <ScheduleSetupWizard projectId={projectId} open={open} onOpenChange={setOpen} />
  );

  // No baseline → gated. A disabled button plus the reason, not a dead-end.
  if (!hasBaseline) {
    return (
      <EmptyState
        variant="page"
        icon={<CalendarClock size={28} strokeWidth={1.6} aria-hidden="true" />}
        title={tw('gate.noBaselineTitle')}
        description={tw('gate.noBaseline')}
        action={<RefButton disabled>{tw('cta.setUp')}</RefButton>}
      />
    );
  }

  // No schedule yet → the CTA is the primary affordance.
  if (!hasSchedule) {
    return (
      <>
        <EmptyState
          variant="page"
          icon={<CalendarClock size={28} strokeWidth={1.6} aria-hidden="true" />}
          title={tw('cta.title')}
          description={tw('cta.description')}
          action={<RefButton onClick={() => setOpen(true)}>{tw('cta.setUp')}</RefButton>}
        />
        {wizard}
      </>
    );
  }

  // A schedule exists → a compact re-entry.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <CalendarClock size={20} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-gray-900">{tw('cta.setTitle')}</p>
          <p className="text-xs text-gray-500">{tw('cta.setDescription')}</p>
        </div>
      </div>
      <RefButton variant="outline" size="sm" onClick={() => setOpen(true)}>
        {tw('cta.edit')}
      </RefButton>
      {wizard}
    </div>
  );
}
