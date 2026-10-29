import { AuditLogsList } from '@/features/audit/components/audit-logs-list';

/** The workspace shell supplies the `h1` and the tab bar; the list supplies its title block. */
export default function AuditLogsPage() {
  return <AuditLogsList />;
}
