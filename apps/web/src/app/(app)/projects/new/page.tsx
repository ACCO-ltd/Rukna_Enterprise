import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ProjectForm } from '@/features/projects/components/project-form';

export default async function NewProjectPage() {
  const t = await getTranslations('platform.projects.create');

  return (
    <div className="w-full max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t('breadcrumb'), href: '/projects' }]}
        title={t('title')}
        subtitle={t('subtitle')}
      />
      <ProjectForm />
    </div>
  );
}
