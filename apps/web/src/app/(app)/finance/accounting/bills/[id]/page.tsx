import { SupplierBillDetail } from '@/features/procurement/components/bill-screens';

export default async function SupplierBillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="w-full max-w-6xl">
      <SupplierBillDetail id={id} />
    </div>
  );
}
