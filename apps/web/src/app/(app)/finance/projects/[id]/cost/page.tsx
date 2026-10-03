import { CostControlView } from '@/features/finance/components/cost-control-view';

/** Cost & commitments: the project's Cost Control view, unchanged. */
export default async function FinanceProjectCostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CostControlView projectId={id} />;
}
