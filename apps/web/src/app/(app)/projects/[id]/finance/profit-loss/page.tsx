import { ProfitLossView } from '@/features/finance/components/profit-loss-view';

export default async function ProfitLossPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfitLossView projectId={id} />;
}
