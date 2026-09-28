import { redirect } from 'next/navigation';

/** Folded into Contract. */
export default async function CommercialMainContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/commercial/contract`);
}
