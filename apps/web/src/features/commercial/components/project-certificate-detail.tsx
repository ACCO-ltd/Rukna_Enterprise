'use client';

import { ProjectApplicationBoundary } from './project-application-boundary';
import { IpcDetail } from '@/features/ipc/components/ipc-detail';

/**
 * Client wrapper for the project-scoped certificate detail route. Resolves the project's contract
 * via the boundary, then mounts the shared `IpcDetail` with a workspace `basePath` so its back
 * link and "open application" link stay inside the Commercial workspace.
 */
export function ProjectCertificateDetail({
  projectId,
  ipaId,
  ipcId,
}: {
  projectId: string;
  ipaId: string;
  ipcId: string;
}) {
  const basePath = `/projects/${projectId}/commercial/applications`;

  return (
    <ProjectApplicationBoundary projectId={projectId}>
      {(contractId) => (
        <IpcDetail contractId={contractId} ipaId={ipaId} ipcId={ipcId} basePath={basePath} />
      )}
    </ProjectApplicationBoundary>
  );
}
