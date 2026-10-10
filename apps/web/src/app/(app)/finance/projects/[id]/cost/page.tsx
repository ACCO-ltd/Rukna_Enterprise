import { FinanceProjectCostDetail } from '@/features/finance-projects/components/finance-project-drill-in';

/** Cost detail — a drill-in from the Overview's cost card (ADR-043 amendment, 2026-10-10). */
export default async function FinanceProjectCostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectCostDetail projectId={id} />;
}
