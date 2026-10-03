import { FinanceProjectCashflow } from '@/features/finance-projects/components/finance-project-cashflow';

export default async function FinanceProjectCashflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectCashflow projectId={id} />;
}
