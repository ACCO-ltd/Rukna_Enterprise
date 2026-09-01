import { GovernanceWorkspace } from '@/features/workflows/components/governance-workspace';

/**
 * Governance Builder workspace — the full-page policy detail surface (S1) that replaces the
 * retired builder sheet. Deep-linkable, back-button-correct, shareable: the policy inventory
 * at `/admin/workflows` now navigates here on a row click instead of opening a drawer.
 *
 * The server shell resolves the route param and hands off to the client `GovernanceWorkspace`,
 * which owns the header, lifecycle bar, tabs and validation rail. The active tab is carried in
 * `?tab=`, so the page reads its own state from the URL.
 */
export default async function GovernanceWorkspacePage({
  params,
}: {
  params: Promise<{ policyId: string }>;
}) {
  const { policyId } = await params;

  return <GovernanceWorkspace policyId={policyId} />;
}
