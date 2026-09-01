import { getTranslations } from 'next-intl/server';
import { SectionHeader } from '@erp/ui';

import { PageHeader } from '@/components/layout/page-header';
import { GovernanceBindingsPanel } from '@/features/workflows/components/governance-bindings-panel';
import { ApprovalPolicyInventory } from '@/features/workflows/components/approval-policy-inventory';
import { WorkflowDefinitionViewer } from '@/features/workflows/components/workflow-definition-viewer';

export default async function WorkflowsPage() {
  const t = await getTranslations('platform.workflows');

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="space-y-10">
        {/* The policy inventory is the spine of this page — it leads. */}
        <ApprovalPolicyInventory />

        {/* Everything below is read-only reference, grouped under one section header. */}
        <section aria-labelledby="governance-reference-heading" className="space-y-6">
          <SectionHeader id="governance-reference-heading" title={t('governanceReference')} />
          <p className="-mt-2 text-sm text-muted-foreground">{t('governanceReferenceHint')}</p>
          <GovernanceBindingsPanel />
          <WorkflowDefinitionViewer />
        </section>
      </div>
    </>
  );
}
