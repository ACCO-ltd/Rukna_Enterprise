import { BuyerAdvanceDetail } from '@/features/procurement/components/buyer-advance-screens';

export default async function BuyerAdvanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="w-full max-w-6xl">
      <BuyerAdvanceDetail id={id} />
    </div>
  );
}
