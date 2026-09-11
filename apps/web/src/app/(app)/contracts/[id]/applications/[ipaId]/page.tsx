import { ContractApplicationRedirect } from '@/features/contracts/components/contract-application-redirect';

/**
 * The standalone payment-application (IPA) detail page is folded into the project Commercial
 * workspace (P3 Slice C). This route now only catches legacy deep-links and forwards them to
 * `/projects/:projectId/commercial/applications/:ipaId`; the client boundary resolves the
 * contract's projectId and replaces the URL.
 */
export default async function IpaDetailPage({
  params,
}: {
  params: Promise<{ id: string; ipaId: string }>;
}) {
  const { id, ipaId } = await params;

  return (
    <div className="w-full max-w-5xl">
      <ContractApplicationRedirect contractId={id} target="application-detail" ipaId={ipaId} />
    </div>
  );
}
