import { FinanceOverviewView } from '@/features/finance/components/finance-overview-view';

/** The same project Finance Overview, with its cost-control link kept inside Finance. */
export default async function FinanceProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceOverviewView projectId={id} costControlHref={`/finance/projects/${id}/cost`} />;
}
