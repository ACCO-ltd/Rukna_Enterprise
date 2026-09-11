import { ContractEditRedirect } from '@/features/contracts/components/contract-edit-redirect';

/**
 * The standalone contract edit page is retired (P3 Slice B). This route now only catches legacy
 * deep-links and forwards them into the project's Commercial workspace edit route; the client
 * boundary resolves the contract's projectId and replaces the URL.
 */
export default async function LegacyEditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="w-full max-w-4xl">
      <ContractEditRedirect contractId={id} />
    </div>
  );
}
