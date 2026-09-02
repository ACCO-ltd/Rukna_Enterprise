import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ProjectSubtypesManager } from '@/features/project-types/components/project-subtypes-manager';

export default async function ProjectSubtypesPage() {
  const t = await getTranslations('projectTypes.manager');

  return (
    <>
      <PageHeader title={t('title')} />
      <ProjectSubtypesManager />
    </>
  );
}
