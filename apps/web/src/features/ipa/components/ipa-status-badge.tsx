import { IpaStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

/** An interim payment application's status. Tone from the status registry (ADR-034). */
export function IpaStatusBadge({ status }: { status: IpaStatus }) {
  const t = useTranslations('platform.ipa.status');

  return <StatusPill tone={statusTone(status, 'ipa')}>{t(status)}</StatusPill>;
}
