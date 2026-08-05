'use client';

import { useTranslations } from 'next-intl';

import { LifecycleCommandDrawer } from '@/components/lifecycle-command-drawer';
import { ApiError } from '@/lib/api-client';

import { useSupersede } from '../hooks/use-ipc';
import type { Ipc } from '../types';

interface IpcSupersessionDrawerProps {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  /** The certificate that will become effective after supersession. */
  newCert: Ipc;
  /** The currently effective certificate, shown in the impact copy. Null on the first cert. */
  effectiveCert: Ipc | null;
  onSuccess?: () => void;
}

export function IpcSupersessionDrawer({
  open,
  onClose,
  applicationId,
  newCert,
  effectiveCert,
  onSuccess,
}: IpcSupersessionDrawerProps) {
  const t = useTranslations('platform.ipc.supersession');
  const tIpc = useTranslations('platform.ipc');
  const supersede = useSupersede(applicationId);

  const currentRef = effectiveCert
    ? (effectiveCert.certificateRef ?? `#${effectiveCert.certificateNumber}`)
    : '—';
  const newRef = newCert.certificateRef ?? `#${newCert.certificateNumber}`;

  const handleClose = () => {
    supersede.reset();
    onClose();
  };

  const errorMessage = supersede.isError
    ? (supersede.error instanceof ApiError && supersede.error.message
        ? supersede.error.message
        : t('failed'))
    : undefined;

  return (
    <LifecycleCommandDrawer
      open={open}
      onClose={handleClose}
      commandName={t('commandName')}
      currentStatus={effectiveCert?.status ?? newCert.status}
      nextStatus="SUPERSEDED"
      businessImpact={
        effectiveCert
          ? t('businessImpact', { currentRef, newRef })
          : undefined
      }
      reason={{
        required: true,
        label: t('reasonLabel'),
        hint: t('reasonHint'),
      }}
      confirmLabel={t('confirmLabel')}
      isPending={supersede.isPending}
      errorMessage={errorMessage}
      onConfirm={(reason) => {
        supersede.mutate(
          { newCertificateId: newCert.id, reason },
          {
            onSuccess: () => {
              handleClose();
              onSuccess?.();
            },
          },
        );
      }}
    />
  );
}
