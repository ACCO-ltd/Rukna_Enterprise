import { IpcStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

import type { SettlementState } from '../settlement';

/**
 * `PARTIALLY_CERTIFIED` is a warning rather than a neutral state: the certifier allowed less
 * than was claimed, which is the line a quantity surveyor needs to look at. `CERTIFIED` is
 * `live` because it is the document the client owes against.
 */
const STATUS_TONES: Record<IpcStatus, BadgeTone> = {
  [IpcStatus.CERTIFIED]: 'live',
  [IpcStatus.PARTIALLY_CERTIFIED]: 'warning',
  [IpcStatus.REJECTED]: 'danger',
};

export function IpcStatusBadge({ status }: { status: IpcStatus }) {
  const t = useTranslations('platform.ipc.status');

  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}

/**
 * Whether a certificate has been superseded, which matters more than its status once it has.
 *
 * Exactly one certificate per application is effective; a superseded one is a historical
 * record that must not be paid against. Rendering it as `neutral` rather than `danger` is
 * deliberate — being replaced is the normal course of a re-certification, not a fault.
 */
export function IpcEffectiveBadge({ isEffective }: { isEffective: boolean }) {
  const t = useTranslations('platform.ipc.effective');

  return (
    <Badge tone={isEffective ? 'accent' : 'neutral'}>
      {isEffective ? t('effective') : t('superseded')}
    </Badge>
  );
}

/**
 * How much of the certificate has been paid.
 *
 * `OVER_ALLOCATED` is `danger` because it is a data fault rather than a payment state — more
 * has been applied to this certificate than it is worth, which C17 (#14) makes reachable.
 */
const SETTLEMENT_TONES: Record<SettlementState, BadgeTone> = {
  UNPAID: 'neutral',
  PARTIALLY_PAID: 'info',
  PAID: 'live',
  OVER_ALLOCATED: 'danger',
};

export function SettlementBadge({ state }: { state: SettlementState }) {
  const t = useTranslations('platform.ipc.settlement');

  return <Badge tone={SETTLEMENT_TONES[state]}>{t(state)}</Badge>;
}
