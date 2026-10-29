import { StatementWorkspace } from '@/features/bank-reconciliation/statement-workspace';

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StatementWorkspace id={id} />;
}
