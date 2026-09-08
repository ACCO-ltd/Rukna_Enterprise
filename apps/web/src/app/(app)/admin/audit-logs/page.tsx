import { getTranslations } from 'next-intl/server';

import { AdminPanel } from '@/features/admin/components/admin-panel';
import { AuditLogsList } from '@/features/audit/components/audit-logs-list';

export default async function AuditLogsPage() {
  const t = await getTranslations('platform.auditLogs');

  return (
    <AdminPanel title={t('title')} description={t('subtitle')}>
      <AuditLogsList />
    </AdminPanel>
  );
}
