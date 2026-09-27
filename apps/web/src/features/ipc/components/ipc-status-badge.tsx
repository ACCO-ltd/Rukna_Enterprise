import { IpcStatus } from '@erp/types';
import { useTranslations } from 'next-intl';
import { StatusPill, StatusText } from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

import type { SettlementState } from '../settlement';

/** A certificate's primary status. Tone from the status registry (ADR-034). */
export function IpcStatusBadge({ status }: { status: IpcStatus }) {
  const t = useTranslations('platform.ipc.status');

  return <StatusPill tone={statusTone(status, 'ipc')}>{t(status)}</StatusPill>;
}

/**
 * Whether a certificate has been superseded, which matters more than its status once it has.
 *
 * Exactly one certificate per application is effective; a superseded one is a historical record
 * that must not be paid against. A second axis beside the status pill, so it renders as quiet
 * dot + text rather than a competing pill.
 */
export function IpcEffectiveBadge({ isEffective }: { isEffective: boolean }) {
  // `platform.ipc.effective` and `.superseded` are flat siblings rather than a nested
  // `effective: { effective, superseded }` object, because `IpcListPanel` already reads them
  // that way. Two shapes for the same two words is how the catalogue ends up with both.
  const t = useTranslations('platform.ipc');

  return (
    <StatusText tone={statusTone(isEffective ? 'EFFECTIVE' : 'SUPERSEDED', 'ipcEffectiveness')}>
      {isEffective ? t('effective') : t('superseded')}
    </StatusText>
  );
}

/**
 * How much of the certificate has been paid — a secondary axis to the certificate status.
 *
 * `OVER_ALLOCATED` is `danger` because it is a data fault rather than a payment state — more
 * has been applied to this certificate than it is worth, which C17 (#14) makes reachable.
 */
export function SettlementBadge({ state }: { state: SettlementState }) {
  const t = useTranslations('platform.ipc.settlement');

  return <StatusText tone={statusTone(state, 'ipcSettlement')}>{t(state)}</StatusText>;
}
