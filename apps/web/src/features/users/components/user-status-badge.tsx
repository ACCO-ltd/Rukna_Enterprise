import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

import { UserStatus } from '../types';

const STATUS_TONES: Record<UserStatus, BadgeTone> = {
  [UserStatus.ACTIVE]: 'live',
  [UserStatus.INACTIVE]: 'neutral',
  [UserStatus.SUSPENDED]: 'warning',
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const t = useTranslations('platform.users.status');

  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}
