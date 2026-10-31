import { SupplierPaymentsList } from '@/features/procurement/components/payment-screens';

/** The list's own totals and its "To approve" / "To post" views say what waits (SP-4). */
export default function SupplierPaymentsPage() {
  return (
    <div className="w-full max-w-6xl">
      <SupplierPaymentsList />
    </div>
  );
}
