import { useTranslations } from 'next-intl';
import { DprStatus } from '@erp/types';

import { RefPill, type RefTone } from './ref-ui';

export const statusPillTone: Record<DprStatus, RefTone> = {
  [DprStatus.DRAFT]: 'gray',
  [DprStatus.SUBMITTED]: 'blue',
  [DprStatus.APPROVED]: 'green',
  [DprStatus.RETURNED]: 'amber',
  [DprStatus.REOPENED]: 'amber',
};

export function DprStatusBadge({ status }: { status: `${DprStatus}` }) {
  const t = useTranslations('progress');
  return <RefPill tone={statusPillTone[status as DprStatus] ?? 'gray'}>{t(`report.status.${status}`)}</RefPill>;
}
