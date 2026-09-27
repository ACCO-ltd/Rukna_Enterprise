import { InvoiceCreate } from '@/features/accounting/components/invoice-create';

export default function NewInvoicePage() {
  return (
    <div className="w-full max-w-5xl">
      <InvoiceCreate />
    </div>
  );
}
