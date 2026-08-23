import { useTranslations } from 'next-intl';
import { DprStatus } from '@erp/types';
import { Badge, type BadgeTone } from '@erp/ui';

const TONES: Record<DprStatus, BadgeTone> = {
  [DprStatus.DRAFT]: 'neutral',
  [DprStatus.SUBMITTED]: 'info',
  [DprStatus.APPROVED]: 'live',
  [DprStatus.RETURNED]: 'warning',
  [DprStatus.REOPENED]: 'warning',
};

export function DprStatusBadge({ status }: { status: `${DprStatus}` }) {
  const t = useTranslations('progress');
  return <Badge tone={TONES[status as DprStatus] ?? 'neutral'}>{t(`report.status.${status}`)}</Badge>;
}
