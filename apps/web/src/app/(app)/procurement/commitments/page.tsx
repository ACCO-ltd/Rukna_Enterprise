import { CommitmentLedger } from '@/features/procurement/components/commitments';

export default async function CommitmentLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <CommitmentLedger initialProjectId={projectId} />
    </div>
  );
}
