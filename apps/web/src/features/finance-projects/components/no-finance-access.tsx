'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@erp/ui';

/** Finance → Projects is for holders of view:financial-position, the API's own gate (ADR-043). */
export function NoFinanceAccess() {
  const t = useTranslations('finance.projects.noAccess');
  return (
    <EmptyState
      variant="page"
      icon={<Lock size={24} aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
    />
  );
}
