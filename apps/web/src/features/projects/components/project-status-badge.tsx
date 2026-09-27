import { ProjectStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

/** A project's lifecycle status. Tone from the status registry (ADR-034); label translated. */
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations('platform.projects.status');

  return <StatusPill tone={statusTone(status, 'project')}>{t(status)}</StatusPill>;
}
