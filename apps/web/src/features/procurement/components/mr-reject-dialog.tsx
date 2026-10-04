'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Textarea,
} from '@erp/ui';

/**
 * Reject a submitted material request — it goes back to DRAFT with the reason, so the requester
 * can change it and submit again. The reason is required: a bare "rejected" tells them nothing.
 */
export function MrRejectDialog({
  number,
  busy,
  error,
  onReject,
  onClose,
}: {
  number: string;
  busy: boolean;
  error: string | null;
  onReject: (reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.mr.reject');
  const tCommon = useTranslations('common');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const missing = reason.trim() === '';

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="md"
      title={t('title', { number })}
      subtitle={t('subtitle')}
      dirty={reason.trim() !== ''}
      busy={busy}
      closeLabel={tCommon('close')}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!missing) onReject(reason.trim());
      }}
    >
      <FormDialogBody className="space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <FormField
          htmlFor="mr-reject-reason"
          label={t('reason')}
          required
          hint={t('reasonHint')}
          error={tried && missing ? t('reasonRequired') : undefined}
        >
          <Textarea id="mr-reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" variant="destructive" loading={busy}>
          {t('confirm')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
