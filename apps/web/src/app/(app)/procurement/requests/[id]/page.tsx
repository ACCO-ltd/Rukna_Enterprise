import { MrDetail } from '@/features/procurement/components/mr-detail';

export default async function MaterialRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <MrDetail id={id} />
    </div>
  );
}
