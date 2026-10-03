import { FinanceProjectPayments } from '@/features/finance-projects/components/finance-project-payments';

export default async function FinanceProjectPaymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectPayments projectId={id} />;
}
