import { StatementWorkspace } from '@/features/bank-reconciliation/statement-workspace';

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="w-full min-w-0 max-w-6xl">
      <StatementWorkspace id={id} />
    </div>
  );
}
