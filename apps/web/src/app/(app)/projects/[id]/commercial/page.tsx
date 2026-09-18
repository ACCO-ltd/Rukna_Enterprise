import { redirect } from 'next/navigation';

/**
 * Root `/commercial` route — redirects to the Overview tab (Slice 7).
 * Overview is now the authoritative landing for all billing models.
 */
export default async function CommercialRootPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}/commercial/overview`);
}
