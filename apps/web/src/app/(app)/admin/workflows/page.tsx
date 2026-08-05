import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { WorkflowDefinitionViewer } from '@/features/workflows/components/workflow-definition-viewer';

export default async function WorkflowsPage() {
  const t = await getTranslations('platform.workflows');

  return (
    <>
      <PageHeader title={t('title')} />
      <WorkflowDefinitionViewer />
    </>
  );
}
