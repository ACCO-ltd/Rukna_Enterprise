import { getTranslations } from 'next-intl/server';

import { ProjectEdit } from '@/features/projects/components/project-edit';

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('platform.projects.detail');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('editTitle')}</h1>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ProjectEdit id={id} />
      </div>
    </div>
  );
}
