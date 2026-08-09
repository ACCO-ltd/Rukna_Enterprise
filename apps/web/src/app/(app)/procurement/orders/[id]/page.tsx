import { PoDetail } from '@/features/procurement/components/po-detail';

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PoDetail id={id} />
    </div>
  );
}
