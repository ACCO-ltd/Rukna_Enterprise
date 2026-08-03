import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';

import { ProjectsList } from '@/features/projects/components/projects-list';

export default async function ProjectsPage() {
  const t = await getTranslations('platform.projects');

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <Button asChild>
          <Link href="/projects/new">{t('newProject')}</Link>
        </Button>
      </div>

      <div className="mt-6">
        <ProjectsList />
      </div>
    </div>
  );
}
