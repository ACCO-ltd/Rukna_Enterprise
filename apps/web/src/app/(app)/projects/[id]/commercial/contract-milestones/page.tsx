import { redirect } from 'next/navigation';

/** Renamed to Contract (2026-09-28). */
export default async function ContractMilestonesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/commercial/contract`);
}
