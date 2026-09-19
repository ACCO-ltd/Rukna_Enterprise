'use client';

import { useRouter } from 'next/navigation';
import { ProcurementOverviewView } from './procurement-overview-view';

/**
 * Thin client wrapper around ProcurementOverviewView that converts the `onGoTo` callback
 * (previously a view-switcher call) into Next.js router navigations to the sub-route tabs.
 *
 * Kept separate from the server page so the page itself stays a Server Component and the
 * router dependency stays out of the feature view.
 */
export function ProcurementOverviewPageContent({ projectId }: { projectId: string }) {
  const router = useRouter();
  return (
    <ProcurementOverviewView
      projectId={projectId}
      onGoTo={(view) => {
        if (view === 'requirements') {
          router.push(`/projects/${projectId}/procurement/requests`);
        } else {
          router.push(`/projects/${projectId}/procurement/purchases`);
        }
      }}
    />
  );
}
