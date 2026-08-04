import { IpaDetail } from '@/features/ipa/components/ipa-detail';

export default async function IpaDetailPage({
  params,
}: {
  params: Promise<{ id: string; ipaId: string }>;
}) {
  const { id, ipaId } = await params;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <IpaDetail contractId={id} ipaId={ipaId} />
    </div>
  );
}
