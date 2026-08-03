import { ContractStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

/**
 * Contract statuses mapped onto the shared tone vocabulary.
 *
 * `TERMINATED` and `CANCELLED` share the danger tone because both are abnormal endings,
 * and the label carries the distinction — cancelled means the contract never took effect,
 * terminated means it did and was stopped early. `FINAL_ACCOUNT_PENDING` is a warning: it
 * is a state that needs someone to act, not a resting place.
 */
const STATUS_TONES: Record<ContractStatus, BadgeTone> = {
  [ContractStatus.DRAFT]: 'neutral',
  [ContractStatus.UNDER_REVIEW]: 'info',
  [ContractStatus.PENDING_SIGNATURE]: 'accent',
  [ContractStatus.ACTIVE]: 'live',
  [ContractStatus.FINAL_ACCOUNT_PENDING]: 'warning',
  [ContractStatus.CLOSED]: 'neutral',
  [ContractStatus.CANCELLED]: 'danger',
  [ContractStatus.TERMINATED]: 'danger',
};

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const t = useTranslations('platform.contracts.status');

  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}
