import { FinanceProjectPl } from '@/features/finance-projects/components/finance-project-pl';

export default async function FinanceProjectPlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectPl projectId={id} />;
}
