import { NewProjectCertificate } from '@/features/commercial/components/new-project-certificate';

/**
 * Issue a payment certificate (IPC) inside the project Commercial workspace (P3 Slice C).
 *
 * The contract is resolved from the commercial summary by the client wrapper; the project and the
 * application id travel in the URL. On success the wizard returns to the application detail inside
 * the workspace.
 */
export default async function IssueProjectCertificatePage({
  params,
}: {
  params: Promise<{ id: string; ipaId: string }>;
}) {
  const { id, ipaId } = await params;

  return <NewProjectCertificate projectId={id} ipaId={ipaId} />;
}
