import { ReceiptDetail } from '@/features/receipts/components/receipt-detail';

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ReceiptDetail receiptId={id} />
    </div>
  );
}
