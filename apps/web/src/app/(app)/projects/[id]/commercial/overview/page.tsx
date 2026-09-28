import { redirect } from 'next/navigation';

/** The Overview view was folded into the bar and Billing's To do (2026-09-28). */
export default async function CommercialOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/commercial`);
}
