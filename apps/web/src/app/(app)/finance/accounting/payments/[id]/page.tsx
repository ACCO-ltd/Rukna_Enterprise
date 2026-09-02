import { SupplierPaymentDetail } from '@/features/procurement/components/payment-screens';

export default async function SupplierPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="w-full max-w-4xl">
      <SupplierPaymentDetail id={id} />
    </div>
  );
}
