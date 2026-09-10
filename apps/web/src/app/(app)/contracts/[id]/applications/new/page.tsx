import { ContractApplicationRedirect } from '@/features/contracts/components/contract-application-redirect';

/**
 * The standalone "new payment application" page is folded into the project Commercial workspace
 * (P3 Slice C). This route now only catches legacy deep-links and forwards them to
 * `/projects/:projectId/commercial/applications/new`; the client boundary resolves the contract's
 * projectId and replaces the URL.
 */
export default async function NewIpaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="w-full max-w-4xl">
      <ContractApplicationRedirect contractId={id} target="application-new" />
    </div>
  );
}
