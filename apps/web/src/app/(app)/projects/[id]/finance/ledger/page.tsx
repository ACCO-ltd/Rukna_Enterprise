import { LedgerView } from '@/features/finance/components/ledger-view';

export default async function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LedgerView projectId={id} />;
}
