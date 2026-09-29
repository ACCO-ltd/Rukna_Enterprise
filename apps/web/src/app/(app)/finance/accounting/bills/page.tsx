import { GuideHint } from '@/features/accounting/components/guide-hint';
import { SupplierBillsList } from '@/features/procurement/components/bill-screens';

export default function SupplierBillsPage() {
  return (
    <div className="w-full max-w-6xl">
      <GuideHint cycleKey="daily" stepKey="bills" />
      <SupplierBillsList />
    </div>
  );
}
