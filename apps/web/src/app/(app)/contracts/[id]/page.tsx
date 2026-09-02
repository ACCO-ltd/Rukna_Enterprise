import { ContractDetail } from '@/features/contracts/components/contract-detail';

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="w-full max-w-5xl">
      <ContractDetail contractId={id} />
    </div>
  );
}
