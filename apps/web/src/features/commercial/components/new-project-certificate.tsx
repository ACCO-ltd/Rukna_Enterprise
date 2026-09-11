'use client';

import { ProjectApplicationBoundary } from './project-application-boundary';
import { IpcWizard } from '@/features/ipc/wizard/ipc-wizard';

/**
 * Client wrapper for the project-scoped "issue certificate" route. Resolves the project's contract
 * via the boundary, then mounts the shared `IpcWizard` with a workspace `basePath` so the
 * post-issue redirect returns to the application inside the Commercial workspace.
 */
export function NewProjectCertificate({
  projectId,
  ipaId,
}: {
  projectId: string;
  ipaId: string;
}) {
  const basePath = `/projects/${projectId}/commercial/applications`;

  return (
    <ProjectApplicationBoundary projectId={projectId}>
      {(contractId) => <IpcWizard contractId={contractId} ipaId={ipaId} basePath={basePath} />}
    </ProjectApplicationBoundary>
  );
}
