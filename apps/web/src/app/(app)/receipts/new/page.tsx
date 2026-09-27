import { ReceiptForm } from '@/features/receipts/components/receipt-form';

export default function NewReceiptPage() {
  return (
    <div className="w-full max-w-4xl">
      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ReceiptForm />
      </div>
    </div>
  );
}
