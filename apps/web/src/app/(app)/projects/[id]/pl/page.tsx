import { redirect } from 'next/navigation';

/**
 * The Finance tab used to land here, on the Project Actual P&L alone — a subset presented as the
 * whole project's finances. It now lands on the Finance workspace; this route keeps every
 * existing link, bookmark and notification working by sending them to the report they meant.
 */
export default async function LegacyProjectPlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}/finance/profit-loss`);
}
