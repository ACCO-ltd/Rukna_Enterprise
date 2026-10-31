import { InvoiceNew } from '@/features/accounting/components/invoice-new';

/** ADR-048 — kept for links to the old sale form; it is now the default New invoice type. */
export default function NewSaleInvoicePage() {
  return (
    <div className="w-full max-w-6xl">
      <InvoiceNew initialType="SALE" />
    </div>
  );
}
