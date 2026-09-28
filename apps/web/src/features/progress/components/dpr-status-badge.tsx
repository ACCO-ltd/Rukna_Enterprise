import { useTranslations } from 'next-intl';
import type { DprStatus } from '@erp/types';

import { StatusBadge } from '@/components/status-badge';

/** A daily progress report's status: the shared StatusBadge on the `dpr` registry vocabulary (ADR-034). */
export function DprStatusBadge({ status }: { status: `${DprStatus}` }) {
  const t = useTranslations('progress');
  return <StatusBadge vocabulary="dpr" status={status} label={t(`report.status.${status}`)} />;
}
