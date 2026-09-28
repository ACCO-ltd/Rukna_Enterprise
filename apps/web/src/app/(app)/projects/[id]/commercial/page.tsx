import { CommercialWorkspace } from '@/features/commercial/components/commercial-workspace';

/** `/commercial` lands billers on Billing and everyone else on Contract (decided client-side). */
export default async function CommercialRootPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CommercialWorkspace projectId={id} active="landing" />;
}
