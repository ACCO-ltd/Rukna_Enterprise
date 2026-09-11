'use client';

import { ProjectApplicationBoundary } from './project-application-boundary';
import { IpaDetail } from '@/features/ipa/components/ipa-detail';

/**
 * Client wrapper for the project-scoped application detail route. Resolves the project's contract
 * via the boundary, then mounts the shared `IpaDetail` with a workspace `basePath` so its back
 * links, certificate CTA and certificate row links stay inside the Commercial workspace.
 */
export function ProjectApplicationDetail({
  projectId,
  ipaId,
}: {
  projectId: string;
  ipaId: string;
}) {
  const basePath = `/projects/${projectId}/commercial/applications`;

  return (
    <ProjectApplicationBoundary projectId={projectId}>
      {(contractId) => <IpaDetail contractId={contractId} ipaId={ipaId} basePath={basePath} />}
    </ProjectApplicationBoundary>
  );
}
