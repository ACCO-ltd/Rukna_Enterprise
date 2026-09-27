import { getTranslations } from 'next-intl/server';

import { ProjectForm } from '@/features/projects/components/project-form';

/**
 * The Projects module header owns the page's `h1` (ADR-035); the wizard names itself in the
 * breadcrumb. What stays here is the one line a creator needs before starting.
 */
export default async function NewProjectPage() {
  const t = await getTranslations('platform.projects.create');

  return (
    <div className="w-full max-w-4xl">
      <p className="mb-4 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      <ProjectForm />
    </div>
  );
}
