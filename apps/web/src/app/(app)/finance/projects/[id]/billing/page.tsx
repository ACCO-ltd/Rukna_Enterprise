import { FinanceProjectBilling } from '@/features/finance-projects/components/finance-project-billing';

export default async function FinanceProjectBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectBilling projectId={id} />;
}
