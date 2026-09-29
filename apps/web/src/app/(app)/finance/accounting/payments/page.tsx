import { GuideHint } from '@/features/accounting/components/guide-hint';
import { SupplierPaymentsList } from '@/features/procurement/components/payment-screens';

export default function SupplierPaymentsPage() {
  return (
    <div className="w-full max-w-6xl">
      <GuideHint cycleKey="daily" stepKey="payments" />
      <SupplierPaymentsList />
    </div>
  );
}
