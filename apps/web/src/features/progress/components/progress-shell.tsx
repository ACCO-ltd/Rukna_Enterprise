'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Skeleton } from '@erp/ui';
import { ClipboardList } from 'lucide-react';

import { usePermissions } from '@/features/auth/permissions/can';
import { WorkspaceSectionHeader } from '@/components/layout/workspace-section-header';
import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';

import {
  canSeeProgressView,
  progressLandingView,
  progressViewHref,
  visibleProgressViews,
  type ProgressAccess,
  type ProgressView,
} from '../domain/progress-views';
import { PROGRESS_PERMISSIONS } from '../permissions';
import { useDprs } from '../hooks/use-progress';
import { useProgressSetup } from '../hooks/use-progress-setup';

/** The reader's Progress permissions, resolved once. */
export function useProgressAccess(): ProgressAccess {
  const { can } = usePermissions();
  return {
    canRecord: can(PROGRESS_PERMISSIONS.record),
    canApprove: can(PROGRESS_PERMISSIONS.approve),
    canManage: can(PROGRESS_PERMISSIONS.manage),
  };
}

/**
 * The Progress tab's frame: heading and the view pills. Every view is its own route under
 * `/projects/{id}/progress/…` (ADR-038 amendment 2026-09-28); a view the reader cannot use is not
 * in the row at all. The header above (ProjectWorkspaceShell) is unchanged — each view owns its one
 * primary action, the tab heading carries none.
 */
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

  const views = visibleProgressViews(access);
  const awaitingReview = dprs.data?.filter((d) => d.status === 'SUBMITTED').length ?? 0;
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
    ? progressLandingView(access, setup.gap !== null && setup.gap !== undefined)
    : null;

  useEffect(() => {
    if (target) router.replace(progressViewHref(projectId, target));
  }, [router, projectId, target]);

  return <ViewSkeleton />;
}

/**
 * Wraps one view's route. A reader who reaches a view they cannot use (a pasted link) is sent to
 * their landing view rather than shown a disabled screen. While setup is incomplete, Today, Review
 * and Performance render one empty state saying what is missing instead of empty cards and zero
 * figures; Plan & setup always renders.
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
  const needsSetup = view !== 'setup';
  const setup = useProgressSetup(projectId);

  useEffect(() => {
    if (!allowed) router.replace(`/projects/${projectId}/progress`);
  }, [allowed, router, projectId]);

  if (!allowed) return <ViewSkeleton />;
  if (!needsSetup) return <>{children}</>;
  if (setup.isPending) return <ViewSkeleton />;
  // A failed setup read is not "unset up": let the view render and show its own error state.
  if (setup.gap) return <SetupIncomplete projectId={projectId} gap={setup.gap} canManage={access.canManage} />;
  return <>{children}</>;
}

function SetupIncomplete({
  projectId,
  gap,
  canManage,
}: {
  projectId: string;
  gap: NonNullable<ReturnType<typeof useProgressSetup>['gap']>;
  canManage: boolean;
}) {
  const t = useTranslations('progress');
  return (
    <EmptyState
      icon={<ClipboardList size={20} aria-hidden="true" />}
      title={t('gate.title')}
      description={canManage ? t(`gate.${gap}`) : `${t(`gate.${gap}`)} ${t('gate.askManager')}`}
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
