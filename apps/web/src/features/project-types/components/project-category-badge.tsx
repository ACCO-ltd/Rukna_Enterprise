'use client';

import { useTranslations } from 'next-intl';
import type { ProjectCategory } from '@erp/types';
import { Badge } from '@erp/ui';

/**
 * The category chip shown on the projects list and the project detail. A legacy project with
 * no category reads as "Untyped" (neutral) rather than fabricating one — the field was added
 * after those projects were created, and a made-up category would be a false report.
 */
export function ProjectCategoryBadge({
  category,
}: {
  category: ProjectCategory | null | undefined;
}) {
  const t = useTranslations('projectTypes');

  if (!category) {
    return <Badge tone="neutral">{t('display.untyped')}</Badge>;
  }

  return <Badge tone="info">{t(`categories.${category}`)}</Badge>;
}
