import { useTranslations } from 'next-intl';
import { StatusPill } from '@erp/ui';
import type { DprStatus } from '@erp/types';

import { statusTone } from '@/lib/status-registry';

/** A daily progress report's status. Tone from the status registry (ADR-034). */
export function DprStatusBadge({ status }: { status: `${DprStatus}` }) {
  const t = useTranslations('progress');
  return <StatusPill tone={statusTone(status, 'dpr')}>{t(`report.status.${status}`)}</StatusPill>;
}
