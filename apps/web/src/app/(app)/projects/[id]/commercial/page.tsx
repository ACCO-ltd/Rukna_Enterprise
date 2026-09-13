import { CommercialWorkspace } from '@/features/commercial/components/commercial-workspace';

/**
 * The retired Overview landing (S-SH-5). Overview is no longer a tab; this route stays only to
 * redirect. `active="overview"` tells the workspace to resolve the real landing tab from the
 * contract's billing model (Payment Schedule for MILESTONE, Contract otherwise) and replace the
 * URL with it, so an old bookmark never dead-ends on a view that no longer exists.
 */
export default async function CommercialOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CommercialWorkspace projectId={id} active="overview" />;
}
