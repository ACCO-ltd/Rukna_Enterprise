import { FinanceProjectTransactions } from '@/features/finance-projects/components/finance-project-transactions';

/** Finance → Projects → Transactions: bills, payments, receipts, journals, ledger, P&L (`?view=`). */
export default async function FinanceProjectTransactionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceProjectTransactions projectId={id} />;
}
