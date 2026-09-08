import { getTranslations } from 'next-intl/server';

import { AdminPanel } from '@/features/admin/components/admin-panel';
import { GovernanceBindingsPanel } from '@/features/workflows/components/governance-bindings-panel';
import { ApprovalPolicyInventory } from '@/features/workflows/components/approval-policy-inventory';
import { WorkflowDefinitionViewer } from '@/features/workflows/components/workflow-definition-viewer';

export default async function WorkflowsPage() {
  const t = await getTranslations('platform.workflows');

  return (
    <div className="space-y-6">
      {/* The policy inventory is the spine of this page — it leads, and brings its own panel. */}
      <ApprovalPolicyInventory />

      {/* Everything below is read-only reference, in a panel of its own. */}
      <AdminPanel title={t('governanceReference')} description={t('governanceReferenceHint')}>
        <div className="space-y-6">
          <GovernanceBindingsPanel />
          <WorkflowDefinitionViewer />
        </div>
      </AdminPanel>
    </div>
  );
}
