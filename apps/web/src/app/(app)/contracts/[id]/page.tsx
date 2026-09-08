import { ContractRedirect } from '@/features/contracts/components/contract-redirect';

/**
 * The standalone contract detail page is retired (P3 Q-C). This route now only exists to
 * catch legacy deep-links and forward them into the project's Commercial workspace; the
 * client boundary resolves the contract's projectId and replaces the URL. Authoring routes
 * under `/contracts/[id]/…` (edit, applications, certificates) are untouched.
 */
export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="w-full max-w-5xl">
      <ContractRedirect contractId={id} />
    </div>
  );
}
