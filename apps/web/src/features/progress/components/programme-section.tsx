'use client';

import { useRouter } from 'next/navigation';

import { progressViewHref } from '../domain/progress-views';
import { PerformanceSection } from './performance-section';
import { VerifiedProgressSection } from './verified-progress-section';

/**
 * Performance — what the numbers say: the progress curve, what needs attention, work-package
 * progress and verified progress. Read-only; every "fix this" link goes to its own view's route.
 * The setup-incomplete state is handled by the view gate, not here. (Plan & setup moved to
 * `setup-view.tsx`.)
 */
export function PerformanceView({ projectId }: { projectId: string }) {
  const router = useRouter();

  return (
    <div className="space-y-8">
      <PerformanceSection
        projectId={projectId}
        onGoTo={(view) => router.push(progressViewHref(projectId, view))}
      />
      <VerifiedProgressSection projectId={projectId} />
    </div>
  );
}
