import { ContractStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

/** A contract's lifecycle status. Tone from the status registry (ADR-034); label translated. */
export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const t = useTranslations('platform.contracts.status');

  return <StatusPill tone={statusTone(status, 'contract')}>{t(status)}</StatusPill>;
}
