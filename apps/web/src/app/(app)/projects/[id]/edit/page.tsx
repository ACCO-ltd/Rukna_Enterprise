import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { ProjectEdit } from '@/features/projects/components/project-edit';

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('platform.projects.detail');

  return (
    <div className="w-full max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t('backToProject'), href: `/projects/${id}` }]}
        title={t('editTitle')}
      />
      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ProjectEdit id={id} />
      </div>
    </div>
  );
}
