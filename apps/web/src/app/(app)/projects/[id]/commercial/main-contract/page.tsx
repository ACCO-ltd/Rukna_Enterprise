import { CommercialWorkspace } from '@/features/commercial/components/commercial-workspace';

export default async function CommercialMainContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CommercialWorkspace projectId={id} active="main-contract" />;
}
