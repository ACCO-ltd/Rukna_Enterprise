import { InvoiceDetail } from '@/features/accounting/components/invoice-detail';

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="w-full max-w-5xl">
      <InvoiceDetail invoiceId={id} />
    </div>
  );
}
