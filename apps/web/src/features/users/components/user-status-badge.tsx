import { useTranslations } from 'next-intl';
import { StatusPill } from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

import { UserStatus } from '../types';

/** A user account's status. Tone from the registry's master-data vocabulary (ADR-034). */
export function UserStatusBadge({ status }: { status: UserStatus }) {
  const t = useTranslations('platform.users.status');

  return <StatusPill tone={statusTone(status, 'masterData')}>{t(status)}</StatusPill>;
}
