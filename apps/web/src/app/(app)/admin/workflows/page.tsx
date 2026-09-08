import { getTranslations } from 'next-intl/server';

import { AdminPanel } from '@/features/admin/components/admin-panel';
import { GovernanceBindingsPanel } from '@/features/workflows/components/governance-bindings-panel';
import { ApprovalPolicyInventory } from '@/features/workflows/components/approval-policy-inventory';
import { WorkflowDefinitionViewer } from '@/features/workflows/components/workflow-definition-viewer';

export default async function WorkflowsPage() {
  const t = await getTranslations('platform.workflows');

  return (
    <div className="space-y-6">
      {/* This screen is the only one in the workspace that holds two panels, so it has to name
          itself — the other five are named by the single panel they contain. Without this the
          page opened straight into "Approval policies" and nothing on it said which tab you
          were on, which is the defect ux-doctrine §9.1 names. Its panels drop to `h3`
          accordingly, so the level is never skipped. */}
      <div>
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* The policy inventory is the spine of this page — it leads, and brings its own panel. */}
      <ApprovalPolicyInventory headingLevel={3} />

      {/* Everything below is read-only reference, in a panel of its own. */}
      <AdminPanel
        headingLevel={3}
        title={t('governanceReference')}
        description={t('governanceReferenceHint')}
      >
        <div className="space-y-6">
          <GovernanceBindingsPanel />
          <WorkflowDefinitionViewer />
        </div>
      </AdminPanel>
    </div>
  );
}
