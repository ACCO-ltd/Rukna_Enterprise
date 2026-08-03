'use client';

import Link from 'next/link';
import { ProjectStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useProject } from '../hooks/use-project';
import { ProjectForm } from './project-form';

/**
 * Loads a project for editing and enforces the DRAFT-only rule before rendering the form.
 *
 * The API rejects a PATCH on a non-DRAFT project with a 400. Reaching this page for an
 * approved project — via a stale tab or a bookmarked URL — should explain that rather than
 * present a form that cannot be saved.
 */
export function ProjectEdit({ id }: { id: string }) {
  const t = useTranslations('platform.projects.detail');
  const tCommon = useTranslations('common');
  const { data: project, isPending, isError, error } = useProject(id);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-96 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);

    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/projects">{t('backToList')}</Link>
        </Button>
      </div>
    );
  }

  if (project.status !== ProjectStatus.DRAFT) {
    return (
      <div className="space-y-4">
        <Alert variant="warning" messages={[t('editNotAllowed')]} />
        <Button variant="outline" asChild>
          <Link href={`/projects/${id}`}>{t('backToProject')}</Link>
        </Button>
      </div>
    );
  }

  return <ProjectForm project={project} />;
}
