import { ContractApplicationRedirect } from '@/features/contracts/components/contract-application-redirect';

/**
 * The standalone "issue payment certificate" (IPC) page is folded into the project Commercial
 * workspace (P3 Slice C). This route now only catches legacy deep-links and forwards them to
 * `/projects/:projectId/commercial/applications/:ipaId/certificates/new`; the client boundary
 * resolves the contract's projectId and replaces the URL.
 */
export default async function IssueCertificatePage({
  params,
}: {
  params: Promise<{ id: string; ipaId: string }>;
}) {
  const { id, ipaId } = await params;

  return <ContractApplicationRedirect contractId={id} target="certificate-new" ipaId={ipaId} />;
}
