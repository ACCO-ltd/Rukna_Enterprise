import { redirect } from 'next/navigation';

export default async function CommercialGuaranteesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}/commercial/contract-security`);
}
