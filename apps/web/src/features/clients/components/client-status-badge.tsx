import { ClientStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

/**
 * A client is either in use or retired — there is no lifecycle to walk, so only two tones
 * are needed. `INACTIVE` is neutral rather than a warning: retiring a client is a normal
 * housekeeping action, not a problem to flag.
 */
const STATUS_TONES: Record<ClientStatus, BadgeTone> = {
  [ClientStatus.ACTIVE]: 'live',
  [ClientStatus.INACTIVE]: 'neutral',
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  const t = useTranslations('platform.clients.status');

  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}
