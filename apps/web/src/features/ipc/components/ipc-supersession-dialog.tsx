'use client';

import { useTranslations } from 'next-intl';

import { LifecycleCommandDialog } from '@/components/lifecycle-command-dialog';
import { ApiError } from '@/lib/api-client';

import { useSupersede } from '../hooks/use-ipc';
import type { Ipc } from '../types';

interface IpcSupersessionDialogProps {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  /** The certificate that will become effective after supersession. */
  newCert: Ipc;
  /** The currently effective certificate, shown in the impact copy. Null on the first cert. */
  effectiveCert: Ipc | null;
  onSuccess?: () => void;
}

export function IpcSupersessionDialog({
  open,
  onClose,
  applicationId,
  newCert,
  effectiveCert,
  onSuccess,
}: IpcSupersessionDialogProps) {
  const t = useTranslations('platform.ipc.supersession');
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
    <LifecycleCommandDialog
      open={open}
      onClose={handleClose}
      commandName={t('commandName')}
      statusVocabulary="ipc"
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
