import { FinanceOverviewView } from '@/features/finance/components/finance-overview-view';

export default async function FinanceOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FinanceOverviewView projectId={id} />;
}
