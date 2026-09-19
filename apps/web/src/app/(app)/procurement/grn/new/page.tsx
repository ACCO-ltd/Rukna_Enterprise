import { GrnForm } from '@/features/procurement/components/grn-screens';

export default async function NewGoodsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialPoId = typeof params.poId === 'string' ? params.poId : undefined;

  return (
    <div className="w-full max-w-5xl">
      <GrnForm initialPoId={initialPoId} />
    </div>
  );
}
