import { IpaStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

/**
 * `RETURNED_FOR_REVISION` is a warning rather than a danger: the application is not
 * broken, it is back with its author and needs work. `SUBMITTED` is `live` because the
 * claim is now with the client and awaiting certification — the state everything
 * downstream keys off.
 */
const STATUS_TONES: Record<IpaStatus, BadgeTone> = {
  [IpaStatus.DRAFT]: 'neutral',
  [IpaStatus.PENDING_INTERNAL_APPROVAL]: 'info',
  [IpaStatus.RETURNED_FOR_REVISION]: 'warning',
  [IpaStatus.APPROVED_FOR_SUBMISSION]: 'accent',
  [IpaStatus.SUBMITTED]: 'live',
  [IpaStatus.CANCELLED]: 'danger',
};

export function IpaStatusBadge({ status }: { status: IpaStatus }) {
  const t = useTranslations('platform.ipa.status');

  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}
