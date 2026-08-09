import { GrnDetail } from '@/features/procurement/components/grn-screens';

export default async function GoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <GrnDetail id={id} />
    </div>
  );
}
