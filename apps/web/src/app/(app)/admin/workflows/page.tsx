import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { GovernanceBindingsPanel } from '@/features/workflows/components/governance-bindings-panel';
import { WorkflowDefinitionViewer } from '@/features/workflows/components/workflow-definition-viewer';

export default async function WorkflowsPage() {
  const t = await getTranslations('platform.workflows');

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="space-y-10">
        <GovernanceBindingsPanel />
        <WorkflowDefinitionViewer />
      </div>
    </>
  );
}
