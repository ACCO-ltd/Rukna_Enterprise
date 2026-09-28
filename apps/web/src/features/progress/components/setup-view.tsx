'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ProgrammeMilestoneResponse, WorkPackageRollupLine } from '@erp/types';
import {
  Alert,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { StepSection } from '@/components/step-section';
import { StatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';
import { useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { useMilestones } from '@/features/programme/hooks/use-programme';
import { CreateMilestoneForm } from '@/features/programme/components/milestones-section';
import { useSetMilestoneWorkPackages } from '@/features/programme/hooks/use-programme';
import { ApiError } from '@/lib/api-client';
import { WorkPackageScheduleSection } from '@/features/programme/components/work-package-schedule-section';
import { ActivitiesSection } from '@/features/programme/components/activities-section';
import { ScheduleSetupCard } from '@/features/programme/components/schedule-setup-card';
import { DownloadMasterScheduleButton } from '@/features/programme/components/download-master-schedule-button';

import { setupStepStates } from '../domain/setup-steps';
import { useProgrammeBaseline, useProjectRollup, useWorkPackages } from '../hooks/use-progress';
import { useBoqLeaves } from '../hooks/use-boq-leaves';
import { useProgressSetup } from '../hooks/use-progress-setup';
import { BaselineSection } from './baseline-section';
import { DeliveryPlanDialog } from './delivery-plan-dialog';
import { CreateWorkPackageDialog, WorkPackageEditor } from './work-packages-section';

/**
 * Plan & setup — how this project's progress is measured, as four ordered steps (BOQ baselined →
 * work packages → planned baseline (optional) → milestones) followed by a collapsed Schedule
 * section. Exactly one step is current and holds the screen's one primary action; finished steps
 * collapse to one line; steps that cannot start yet say what they wait for.
 */
export function SetupView({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();

  const workspace = useBoqWorkspace(projectId);
  const { leaves } = useBoqLeaves(projectId);
  const rollup = useProjectRollup(projectId);
  const workPackages = useWorkPackages(projectId);
  const baseline = useProgrammeBaseline(projectId);
  const milestones = useMilestones(projectId);
  const setup = useProgressSetup(projectId);

  const [planning, setPlanning] = useState(false);
  const [creating, setCreating] = useState(false);

  const loading =
    workspace.isPending || rollup.isPending || workPackages.isPending || baseline.isPending || milestones.isPending;
  const failed =
    workspace.isError || rollup.isError || workPackages.isError || baseline.isError || milestones.isError;

  const version = workspace.data?.approved ?? workspace.data?.contractBaseline ?? null;

  // Items allocated to any package, counted against the BOQ's measurable leaves.
  const allocatedLeafCount = useMemo(() => {
    const leafIds = new Set(leaves.map((l) => l.id));
    const allocated = new Set((workPackages.data ?? []).flatMap((wp) => wp.boqNodeIds ?? []));
    let n = 0;
    for (const id of allocated) if (leafIds.has(id)) n += 1;
    return n;
  }, [leaves, workPackages.data]);
  const sectionCount = useMemo(
    () => new Set(leaves.map((l) => l.path[0] ?? l.code)).size,
    [leaves],
  );

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <Skeleton className="h-16 w-full rounded-panel" aria-hidden="true" />
        <Skeleton className="h-40 w-full rounded-panel" aria-hidden="true" />
        <Skeleton className="h-16 w-full rounded-panel" aria-hidden="true" />
      </div>
    );
  }

  if (failed || !rollup.data) {
    return <Alert variant="error" messages={[t('setup.loadFailed')]} />;
  }

  const facts = setup.facts;
  // The step is done only when nothing in it is left: at least one measurable package, every
  // measurable package allocated, and the server's weights flag true.
  const workPackagesDone = Boolean(
    facts &&
      facts.measurablePackageCount > 0 &&
      facts.unallocatedPackageCodes.length === 0 &&
      facts.weightsComplete,
  );
  const governing = baseline.data ?? null;
  const milestoneList = milestones.data ?? [];
  const states = setupStepStates({
    boqDone: version !== null,
    workPackagesDone,
    baselineDone: governing !== null,
    milestonesDone: milestoneList.length > 0,
  });

  const packageCount = rollup.data.packages.length;
  const weightsPercent = Math.round(Number(rollup.data.weightsTotal) * 100);

  // ── Step 1 summary ─────────────────────────────────────────────────────────
  const boqSummary = version
    ? version.baselinedAt
      ? t('setupView.boq.summaryBaselined', {
          version: version.versionNumber,
          items: leaves.length,
          sections: sectionCount,
          date: formatDate(version.baselinedAt, locale) ?? '',
        })
      : t('setupView.boq.summary', { version: version.versionNumber, items: leaves.length, sections: sectionCount })
    : undefined;

  // ── Step 2 summary ─────────────────────────────────────────────────────────
  const allocationText =
    leaves.length > 0 && allocatedLeafCount >= leaves.length
      ? t('setupView.workPackages.allAllocated', { count: leaves.length })
      : t('setupView.workPackages.someAllocated', { allocated: allocatedLeafCount, count: leaves.length });
  const wpSummary = t('setupView.workPackages.summary', {
    packages: packageCount,
    weights: weightsPercent,
    allocation: allocationText,
  });

  // ── Step 3 summary ─────────────────────────────────────────────────────────
  const points = governing?.points ?? [];
  const baselineSummary = governing
    ? t('setupView.baseline.summary', {
        date: formatDate(governing.approvedAt, locale) ?? '',
        start: points[0] ? (formatDate(points[0].targetDate, locale) ?? '') : '—',
        end: points.length > 0 ? (formatDate(points[points.length - 1]!.targetDate, locale) ?? '') : '—',
        rebaselines: Math.max(0, governing.version - 1),
      })
    : undefined;

  // ── Step 4 summary ─────────────────────────────────────────────────────────
  const milestonesSummary = t('setupView.milestones.summary', {
    count: milestoneList.length,
    verified: milestoneList.filter((m) => m.status === 'VERIFIED').length,
  });

  // The work-packages step speaks to the one gap the setup rules found — never a guess from the
  // packages' own figures, so the message always matches what blocks the step.
  const wpGap = setup.gap === 'allocation' || setup.gap === 'weights' ? setup.gap : null;
  const hasMeasurable = (facts?.measurablePackageCount ?? 0) > 0;

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-body-sm text-muted-foreground">{t('setupView.intro')}</p>

      {/* 1 — BOQ baselined */}
      <StepSection
        step={1}
        state={states.boq}
        title={t('setupView.boq.title')}
        summary={boqSummary}
        description={t('setupView.boq.description')}
        doneAction={{ kind: 'open', href: `/projects/${projectId}/boq`, label: t('setupView.boq.open') }}
      >
        <Button asChild>
          <Link href={`/projects/${projectId}/boq`}>{t('setupView.boq.open')}</Link>
        </Button>
      </StepSection>

      {/* 2 — Work packages */}
      <StepSection
        step={2}
        state={states.workPackages}
        title={t('setupView.workPackages.title')}
        summary={wpSummary}
        description={t('setupView.workPackages.description')}
        waitsFor={t('setupView.workPackages.waitsFor')}
        doneAction={{ kind: 'edit' }}
      >
        {states.workPackages === 'current' && !hasMeasurable ? (
          <div className="space-y-3">
            {packageCount > 0 ? (
              <p className="max-w-prose text-body-sm text-foreground">
                {t('setupView.workPackages.scheduleOnlyNote')}
              </p>
            ) : null}
            <h4 className="text-body-sm font-semibold text-foreground">
              {t('setupView.workPackages.startFromBoq')}
            </h4>
            <p className="max-w-prose text-body-sm text-muted-foreground">
              {t('setupView.workPackages.startFromBoqBody')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setPlanning(true)}>{t('deliveryPlan.action')}</Button>
              <Button variant="outline" onClick={() => setCreating(true)}>
                {t('setupView.workPackages.addManually')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {states.workPackages === 'current' && wpGap ? (
              <p className="max-w-prose text-body-sm text-foreground">
                {wpGap === 'allocation'
                  ? t('setupView.workPackages.gapAllocation', {
                      codes: facts?.unallocatedPackageCodes.join(', ') ?? '',
                      count: facts?.unallocatedPackageCodes.length ?? 0,
                    })
                  : t('setupView.workPackages.gapWeights', { total: weightsPercent })}
              </p>
            ) : null}
            <WorkPackageEditor
              projectId={projectId}
              primary={states.workPackages === 'current' ? (wpGap === 'allocation' ? 'allocate' : 'weights') : null}
            />
          </div>
        )}
      </StepSection>

      {/* 3 — Planned baseline (optional) */}
      <StepSection
        step={3}
        state={states.baseline}
        title={t('setupView.baseline.title')}
        optional
        summary={baselineSummary}
        description={t('setupView.baseline.description')}
        waitsFor={t('setupView.baseline.waitsFor')}
        doneAction={{
          kind: 'edit',
          label: can('approve:project') ? t('baseline.governing.rebaseline') : undefined,
        }}
      >
        <BaselineSection projectId={projectId} />
      </StepSection>

      {/* 4 — Milestones */}
      <StepSection
        step={4}
        state={states.milestones}
        title={t('setupView.milestones.title')}
        summary={milestonesSummary}
        description={t('setupView.milestones.description')}
        waitsFor={t('setupView.milestones.waitsFor')}
        doneAction={{ kind: 'edit' }}
      >
        <div className="space-y-4">
          <MilestonesTable
            projectId={projectId}
            milestones={milestoneList}
            packages={rollup.data.packages.filter((p) => !p.scheduleOnly)}
          />
          <CreateMilestoneForm projectId={projectId} primary={states.milestones === 'current'} />
        </div>
      </StepSection>

      <ScheduleDisclosure projectId={projectId} />

      <DeliveryPlanDialog
        projectId={projectId}
        currency={workspace.data?.currency ?? null}
        moneyHidden={workspace.data ? !workspace.data.capabilities.canViewCost : false}
        open={planning}
        onOpenChange={setPlanning}
      />
      <CreateWorkPackageDialog
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        suggestedCode={`WP-${String(packageCount + 1).padStart(2, '0')}`}
        existingWeightPercent={weightsPercent}
      />
    </div>
  );
}

/**
 * The milestones as a compact table: name, planned date, the packages it needs, the installment it
 * releases, status. The released installment is named by share and name only — its money belongs
 * to Commercial. Verifying moved to Review (where ready milestones are listed); setup shows status.
 * "Set packages…" (manage:project, PLANNED only) chooses which packages make the milestone ready.
 */
function MilestonesTable({
  projectId,
  milestones,
  packages,
}: {
  projectId: string;
  milestones: ProgrammeMilestoneResponse[];
  packages: WorkPackageRollupLine[];
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();
  const [editing, setEditing] = useState<ProgrammeMilestoneResponse | null>(null);
  const canManage = can('manage:project');
  const showActions = canManage && milestones.some((m) => m.status === 'PLANNED');

  if (milestones.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{t('setupView.milestones.empty')}</p>;
  }

  return (
    <>
      <TableScroll aria-label={t('setupView.milestones.title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('setupView.milestones.col.name')}</TableHead>
              <TableHead>{t('setupView.milestones.col.planned')}</TableHead>
              <TableHead>{t('setupView.milestones.col.packages')}</TableHead>
              <TableHead>{t('setupView.milestones.col.releases')}</TableHead>
              <TableHead>{t('setupView.milestones.col.status')}</TableHead>
              {showActions ? (
                <TableHead>
                  <span className="sr-only">{t('setupView.milestones.col.actions')}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {milestones.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <span className="font-medium">{m.name}</span>
                  <span className="ms-2 font-mono text-caption text-muted-foreground">{m.code}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(m.baselineDate, locale)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {m.workPackages.length === 0
                    ? t('setupView.milestones.packagesNone')
                    : m.workPackages.map((wp) => `${wp.code} ${wp.percentComplete}%`).join(', ')}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {m.releases.length === 0
                    ? t('setupView.milestones.releasesNone')
                    : m.releases
                        .map((r) =>
                          t('setupView.milestones.releaseLine', {
                            percent: `${Math.round(Number(r.percentage) * 100)}%`,
                            name: r.name,
                          }),
                        )
                        .join(', ')}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    vocabulary="programmeMilestone"
                    status={m.status}
                    label={t(`programme.status.${m.status}`)}
                  />
                </TableCell>
                {showActions ? (
                  <TableCell className="text-end">
                    {m.status === 'PLANNED' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(m)}
                        aria-label={t('setupView.milestones.setPackagesLabel', { name: m.name })}
                      >
                        {t('setupView.milestones.setPackages')}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      {editing ? (
        <MilestonePackagesDialog
          projectId={projectId}
          milestone={editing}
          packages={packages}
          onDismiss={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/** Choose the (measurable) work packages a milestone needs, then PUT the whole set. */
function MilestonePackagesDialog({
  projectId,
  milestone,
  packages,
  onDismiss,
}: {
  projectId: string;
  milestone: ProgrammeMilestoneResponse;
  packages: WorkPackageRollupLine[];
  onDismiss: () => void;
}) {
  const t = useTranslations('progress');
  const save = useSetMilestoneWorkPackages(projectId);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(milestone.workPackages.map((wp) => wp.id)));

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onDismiss();
      }}
    >
      <DialogContent size="sm">
        <DialogTitle>{t('setupView.milestones.packagesTitle', { name: milestone.name })}</DialogTitle>
        <DialogDescription>{t('setupView.milestones.packagesHint')}</DialogDescription>

        {save.isError ? (
          <div className="mt-4">
            <Alert
              variant="error"
              messages={[save.error instanceof ApiError ? save.error.message : t('setupView.milestones.packagesFailed')]}
            />
          </div>
        ) : null}

        <div className="mt-4 space-y-1">
          {packages.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('setupView.milestones.packagesNoneAvailable')}</p>
          ) : (
            packages.map((p) => (
              <CheckboxField
                key={p.id}
                id={`ms-wp-${p.id}`}
                label={`${p.code} ${p.name}`}
                checked={selected.has(p.id)}
                onChange={(e) => toggle(p.id, e.target.checked)}
              />
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={() =>
              save.mutate(
                { milestoneId: milestone.id, workPackageIds: [...selected] },
                { onSuccess: onDismiss },
              )
            }
            disabled={save.isPending || packages.length === 0}
          >
            {t('setupView.milestones.packagesSave')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={save.isPending}>
            {t('setupView.milestones.packagesCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Master schedule, work-package dates and activities — one collapsed section below the steps. */
function ScheduleDisclosure({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="progress-schedule-title" className="rounded-panel border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="progress-schedule-body"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start sm:px-5 focus-visible:outline-none focus-visible:shadow-ring"
      >
        {open ? (
          <ChevronDown size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span id="progress-schedule-title" className="block text-body font-semibold text-foreground">
            {t('setupView.schedule.title')}
          </span>
          <span className="block text-body-sm text-muted-foreground">{t('setupView.schedule.description')}</span>
        </span>
        <span className="sr-only">{open ? t('setupView.schedule.hide') : t('setupView.schedule.show')}</span>
      </button>

      {open ? (
        <div id="progress-schedule-body" className="space-y-8 border-t border-border px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h3 className="text-body-sm font-semibold text-foreground">{t('masterSchedule.title')}</h3>
            <DownloadMasterScheduleButton projectId={projectId} />
          </div>
          <ScheduleSetupCard projectId={projectId} />
          <WorkPackageScheduleSection projectId={projectId} />
          <ActivitiesSection projectId={projectId} />
        </div>
      ) : null}
    </section>
  );
}
