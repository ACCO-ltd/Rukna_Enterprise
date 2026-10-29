import { ManualInvoiceEdit } from '@/features/accounting/components/manual-invoice-edit';

export default async function EditSaleInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="w-full max-w-6xl">
      <ManualInvoiceEdit id={id} />
    </div>
  );
}
