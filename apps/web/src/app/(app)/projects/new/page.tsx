import { getTranslations } from 'next-intl/server';

import { ProjectForm } from '@/features/projects/components/project-form';

export default async function NewProjectPage() {
  const t = await getTranslations('platform.projects.create');

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5 sm:p-6">
        <ProjectForm />
      </div>
    </div>
  );
}
