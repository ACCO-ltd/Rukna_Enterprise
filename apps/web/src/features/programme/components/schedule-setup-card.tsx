'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@erp/ui';
import { CalendarClock } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
import { usePermissions } from '@/features/auth/permissions/can';
import { PROGRESS_PERMISSIONS } from '@/features/progress/permissions';
import { useBoqLeaves } from '@/features/progress/hooks/use-boq-leaves';
import { useProjectRollup } from '@/features/progress/hooks/use-progress';

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
    return (
      <div
        className="h-28 animate-pulse rounded-panel border border-border bg-muted"
        aria-hidden="true"
      />
    );
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
        action={
          <Button disabled>{tw('cta.setUp')}</Button>
        }
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
          action={<Button onClick={() => setOpen(true)}>{tw('cta.setUp')}</Button>}
        />
        {wizard}
      </>
    );
  }

  // A schedule exists → a compact re-entry.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-container bg-surface-subtle text-muted-foreground">
          <CalendarClock size={20} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div>
          <p className="text-body-sm font-semibold text-foreground">{tw('cta.setTitle')}</p>
          <p className="text-caption text-muted-foreground">{tw('cta.setDescription')}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {tw('cta.edit')}
      </Button>
      {wizard}
    </div>
  );
}
