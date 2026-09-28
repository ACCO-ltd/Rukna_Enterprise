'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DailyProgressReportResponse, ProgrammeMilestoneResponse } from '@erp/types';
import { Button, EmptyState, Notice, Skeleton } from '@erp/ui';
import { ClipboardList } from 'lucide-react';

import { useSession } from '@/features/auth/session/use-session';
import { useMilestones } from '@/features/programme/hooks/use-programme';
import { WorkspaceSectionHeader } from '@/components/layout/workspace-section-header';
import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';

import {
  canSeeProgressView,
  isHardSetupGap,
  type ProgressAccess,
  progressLandingView,
  progressViewHref,
  visibleProgressViews,
  type ProgressSetupFacts,
  type ProgressSetupGap,
  type ProgressView,
} from '../domain/progress-views';
import { useDprs } from '../hooks/use-progress';
import { useProgressAccess } from '../hooks/use-progress-access';
import { useProgressSetup } from '../hooks/use-progress-setup';

/**
 * The Progress tab's frame: heading and the view pills. Every view is its own route under
 * `/projects/{id}/progress/…` (ADR-038 amendment 2026-09-28); a view the reader cannot use is not
 * in the row at all. The header above (ProjectWorkspaceShell) is unchanged — each view owns its one
 * primary action, the tab heading carries none.
 */
export { useProgressAccess };

/**
 * What waits in Review for THIS reader, counting only what they can act on: submitted reports
 * that are not their own (`approve:progress` — a preparer cannot approve their own report), plus
 * milestones the server marks ready to verify (`manage:project`).
 */
export function reviewBadgeCount({
  reports,
  milestones,
  userId,
  access,
}: {
  reports: DailyProgressReportResponse[];
  milestones: ProgrammeMilestoneResponse[];
  userId: string | null;
  access: ProgressAccess;
}): number {
  const reportCount = access.canApprove
    ? reports.filter((d) => d.status === 'SUBMITTED' && d.preparedBy !== userId).length
    : 0;
  const milestoneCount = access.canManage ? milestones.filter((m) => m.readyToVerify).length : 0;
  return reportCount + milestoneCount;
}

export function ProgressShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('progress');
  const access = useProgressAccess();
  const dprs = useDprs(projectId);
  const userId = useSession().user?.id ?? null;

  const milestones = useMilestones(projectId);

  const views = visibleProgressViews(access);
  const awaitingReview = reviewBadgeCount({
    reports: dprs.data ?? [],
    milestones: milestones.data ?? [],
    userId,
    access,
  });
  const labels: Record<ProgressView, string> = {
    today: t('tabs.today'),
    review: t('tabs.review'),
    performance: t('tabs.performance'),
    setup: t('tabs.setup'),
  };

  return (
    <div className="space-y-6">
      <WorkspaceSectionHeader title={t('title')} description={t('subtitle')} />

      <WorkspaceSubNav
        label={t('tabs.label')}
        items={views.map((view) => ({
          value: view,
          label: labels[view],
          href: progressViewHref(projectId, view),
          count: view === 'review' ? awaitingReview : undefined,
          countLabel:
            view === 'review' && awaitingReview > 0
              ? t('tabs.reviewWithCount', { count: awaitingReview })
              : undefined,
        }))}
      />

      <div>{children}</div>
    </div>
  );
}

/**
 * `/progress` itself: send the reader to their landing view (see `progressLandingView`). A setup
 * manager waits for the setup answer so they are not bounced to Today and back.
 */
export function ProgressLanding({ projectId }: { projectId: string }) {
  const router = useRouter();
  const access = useProgressAccess();
  const setup = useProgressSetup(projectId);

  const decided = !access.canManage || !setup.isPending;
  const target = decided
    ? progressLandingView(access, {
        hardGap: isHardSetupGap(setup.gap),
        incomplete: setup.gap !== null && setup.gap !== undefined,
      })
    : null;

  useEffect(() => {
    if (target) router.replace(progressViewHref(projectId, target));
  }, [router, projectId, target]);

  return <ViewSkeleton />;
}

/**
 * Wraps one view's route. A reader who reaches a view they cannot use (a pasted link) is sent to
 * their landing view rather than shown a disabled screen.
 *
 * Only a HARD setup gap — no BOQ baseline, or no measurable work package — replaces Today, Review
 * and Performance with one empty state; nothing can be recorded against nothing. A soft gap (an
 * unallocated package, weights below 100%) never blocks field work: Today and Review render as
 * normal, and Performance carries one inline notice that its figures are provisional. Plan &
 * setup always renders.
 */
export function ProgressViewGate({
  projectId,
  view,
  children,
}: {
  projectId: string;
  view: ProgressView;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const access = useProgressAccess();
  const allowed = canSeeProgressView(view, access);
  const setup = useProgressSetup(projectId);

  useEffect(() => {
    if (!allowed) router.replace(`/projects/${projectId}/progress`);
  }, [allowed, router, projectId]);

  if (!allowed) return <ViewSkeleton />;
  if (view === 'setup') return <>{children}</>;
  if (setup.isPending) return <ViewSkeleton />;
  // A failed setup read is not "unset up": let the view render and show its own error state.
  if (setup.gap && isHardSetupGap(setup.gap)) {
    return <SetupIncomplete projectId={projectId} gap={setup.gap} canManage={access.canManage} />;
  }
  if (view === 'performance' && setup.gap && setup.facts) {
    return (
      <div className="space-y-6">
        <ProvisionalNotice projectId={projectId} gap={setup.gap} facts={setup.facts} canManage={access.canManage} />
        {children}
      </div>
    );
  }
  return <>{children}</>;
}

function SetupIncomplete({
  projectId,
  gap,
  canManage,
}: {
  projectId: string;
  gap: ProgressSetupGap;
  canManage: boolean;
}) {
  const t = useTranslations('progress');
  const reason = gap === 'boq' || gap === 'workPackages' || gap === 'scheduleOnly' ? t(`gate.${gap}`) : '';
  return (
    <EmptyState
      icon={<ClipboardList size={20} aria-hidden="true" />}
      title={t('gate.title')}
      description={canManage ? reason : `${reason} ${t('gate.askManager')}`}
      action={
        canManage ? (
          <Button asChild>
            <Link href={progressViewHref(projectId, 'setup')}>{t('gate.continueSetup')}</Link>
          </Button>
        ) : undefined
      }
    />
  );
}

/** Performance's one notice for a soft gap: the figures are real but provisional. */
function ProvisionalNotice({
  projectId,
  gap,
  facts,
  canManage,
}: {
  projectId: string;
  gap: ProgressSetupGap;
  facts: ProgressSetupFacts;
  canManage: boolean;
}) {
  const t = useTranslations('progress');
  // Both can be true at once; each says its own thing. Weights short of 100% always shows here,
  // whichever gap setup reports first.
  const parts = [
    gap === 'allocation'
      ? t('gate.provisionalAllocation', {
          codes: facts.unallocatedPackageCodes.join(', '),
          count: facts.unallocatedPackageCodes.length,
        })
      : null,
    !facts.weightsComplete ? t('gate.provisionalWeights', { total: facts.weightsPercent }) : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const message = parts.join(' ');
  return (
    <Notice
      tone="attention"
      action={
        canManage ? (
          <Button asChild variant="outline" size="sm">
            <Link href={progressViewHref(projectId, 'setup')}>{t('gate.continueSetup')}</Link>
          </Button>
        ) : undefined
      }
    >
      {message}
    </Notice>
  );
}

function ViewSkeleton() {
  const tCommon = useTranslations('common');
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{tCommon('loading')}</span>
      <Skeleton className="h-24 w-full rounded-panel" aria-hidden="true" />
      <Skeleton className="h-48 w-full rounded-panel" aria-hidden="true" />
    </div>
  );
}
