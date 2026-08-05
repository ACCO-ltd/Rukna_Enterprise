import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ProjectForm } from '@/features/projects/components/project-form';

export default async function NewProjectPage() {
  const t = await getTranslations('platform.projects.create');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: t('breadcrumb'), href: '/projects' }]}
        title={t('title')}
        subtitle={t('subtitle')}
      />
      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ProjectForm />
      </div>
    </div>
  );
}
