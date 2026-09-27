import { ClientStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

/**
 * Whether a client is in use or retired. Tone from the status registry's master-data vocabulary
 * (ADR-034). The category and stage badges elsewhere classify rather than report state, and
 * deliberately carry no dot.
 */
export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  const t = useTranslations('platform.clients.status');

  return <StatusPill tone={statusTone(status, 'masterData')}>{t(status)}</StatusPill>;
}
