import { redirect } from 'next/navigation';

/** Renamed to Billing (2026-09-28). */
export default async function BillingCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/commercial/billing`);
}
