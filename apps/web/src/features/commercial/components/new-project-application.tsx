'use client';

import { ProjectApplicationBoundary } from './project-application-boundary';
import { IpaForm } from '@/features/ipa/components/ipa-form';

/**
 * Client wrapper for the project-scoped "new application" route. Resolves the project's contract
 * via the boundary, then mounts the shared `IpaForm` with a workspace `basePath` so the cancel
 * link and the post-create redirect both stay inside `/projects/:id/commercial/applications`.
 */
export function NewProjectApplication({ projectId }: { projectId: string }) {
  const basePath = `/projects/${projectId}/commercial/applications`;

  return (
    <ProjectApplicationBoundary projectId={projectId}>
      {(contractId) => <IpaForm contractId={contractId} basePath={basePath} />}
    </ProjectApplicationBoundary>
  );
}
