import { CostControlView } from '@/features/finance/components/cost-control-view';

export default async function CostControlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CostControlView projectId={id} />;
}
