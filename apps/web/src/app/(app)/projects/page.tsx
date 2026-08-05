import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';

import { PageHeader } from '@/components/layout/page-header';
import { ProjectsList } from '@/features/projects/components/projects-list';

export default async function ProjectsPage() {
  const t = await getTranslations('platform.projects');

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button asChild>
            <Link href="/projects/new">{t('newProject')}</Link>
          </Button>
        }
      />
      <ProjectsList />
    </>
  );
}
