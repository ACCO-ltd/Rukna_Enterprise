import { FinanceProjectPayables } from '@/features/finance-projects/components/finance-project-payables';

export default async function FinanceProjectPayablesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectPayables projectId={id} />;
}
