import { ProjectCertificateDetail } from '@/features/commercial/components/project-certificate-detail';

/**
 * Payment certificate (IPC) detail inside the project Commercial workspace (P3 Slice C).
 *
 * The contract is resolved from the commercial summary by the client wrapper; the project, the
 * application id and the certificate id travel in the URL.
 */
export default async function ProjectCertificateDetailPage({
  params,
}: {
  params: Promise<{ id: string; ipaId: string; ipcId: string }>;
}) {
  const { id, ipaId, ipcId } = await params;

  return (
    <div className="w-full max-w-5xl">
      <ProjectCertificateDetail projectId={id} ipaId={ipaId} ipcId={ipcId} />
    </div>
  );
}
