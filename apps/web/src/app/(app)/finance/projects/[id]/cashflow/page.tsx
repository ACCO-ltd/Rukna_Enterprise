import { FinanceProjectCashflowDetail } from '@/features/finance-projects/components/finance-project-drill-in';

/** Cash-flow forecast — a drill-in from the Overview's cash-flow card (ADR-043 amendment, 2026-10-10). */
export default async function FinanceProjectCashflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectCashflowDetail projectId={id} />;
}
