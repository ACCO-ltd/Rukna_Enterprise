import { RecordReceiptScreen } from '@/features/procurement/components/quotes/record-receipt-screen';

/**
 * Record a store receipt (ADR-045 wireframe E): the buyer's photo big, one Total, one confirm —
 * bill, match, post and settle from the buyer's cash. The `RECEIPT_TO_RECORD` notification opens it.
 */
export default async function RecordReceiptPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const { id, docId } = await params;
  return (
    <div className="w-full max-w-7xl">
      <RecordReceiptScreen requestId={id} documentId={docId} />
    </div>
  );
}
