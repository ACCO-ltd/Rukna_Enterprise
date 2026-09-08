import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@erp/ui';
import { Plus } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { ProjectsList } from '@/features/projects/components/projects-list';

export default async function ProjectsPage() {
  const t = await getTranslations('platform.projects');

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              {t('newProject')}
            </Link>
          </Button>
        }
      />
      <ProjectsList />
    </>
  );
}
