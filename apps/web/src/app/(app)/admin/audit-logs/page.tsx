import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/layout/page-header';
import { AuditLogsList } from '@/features/audit/components/audit-logs-list';

export default async function AuditLogsPage() {
  const t = await getTranslations('platform.auditLogs');

  return (
    <>
      <PageHeader title={t('title')} />
      <AuditLogsList />
    </>
  );
}
