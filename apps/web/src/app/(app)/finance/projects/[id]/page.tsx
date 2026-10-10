import { FinanceProjectDashboard } from '@/features/finance-projects/components/finance-project-dashboard';

/** Finance → Projects → Overview: the project's finance dashboard (ADR-043). */
export default async function FinanceProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectDashboard projectId={id} />;
}
