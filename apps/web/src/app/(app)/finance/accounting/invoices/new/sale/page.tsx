import { ManualInvoiceForm } from '@/features/accounting/components/manual-invoice-form';

/** ADR-048 — a hand-typed invoice for a sale outside any construction contract. */
export default function NewSaleInvoicePage() {
  return (
    <div className="w-full max-w-6xl">
      <ManualInvoiceForm />
    </div>
  );
}
