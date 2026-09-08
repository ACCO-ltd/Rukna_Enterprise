import { getTranslations } from 'next-intl/server';

import { AdminPanel } from '@/features/admin/components/admin-panel';
import { ProjectSubtypesManager } from '@/features/project-types/components/project-subtypes-manager';

export default async function ProjectSubtypesPage() {
  const t = await getTranslations('projectTypes.manager');

  return (
    <AdminPanel title={t('title')} description={t('intro')}>
      <ProjectSubtypesManager />
    </AdminPanel>
  );
}
