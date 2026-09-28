'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
} from '@erp/ui';

import { useRecordSignedDate } from '@/features/contracts/hooks/use-contracts';

import { commercialKeys } from '../hooks/use-commercial';

/**
 * Back-fills the physically-signed date on an ACTIVE contract that has none — contracts activated
 * before activation required it (legacy create → activate, pre-migration rows).
 */
export function RecordSignedDateDialog({
  open,
  projectId,
  contractId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  contractId: string;
  onClose: () => void;
}) {
  const t = useTranslations('commercial.contractMilestones.recordSignedDate');
  const [signedDate, setSignedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const mutation = useRecordSignedDate(contractId);
  const queryClient = useQueryClient();

  async function handleSubmit() {
    if (!signedDate) return;
    await mutation.mutateAsync(signedDate);
    // useRecordSignedDate only invalidates the contract-detail query; the "Not recorded" text and
    // this dialog's own trigger read `contract.signedDate` / `capabilities.canRecordSignedDate`
    // off the commercial summary, which lives under a different query root and would otherwise
    // stay stale until an unrelated refetch.
    await queryClient.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !mutation.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        {mutation.error ? (
          <Alert variant="error" messages={[(mutation.error as Error).message]} />
        ) : null}
        <FormField htmlFor="contract-signed-date" label={t('signedDate')}>
          <DatePicker
            id="contract-signed-date"
            value={signedDate}
            onChange={setSignedDate}
            disabled={mutation.isPending}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!signedDate || mutation.isPending}>
            {mutation.isPending ? t('submitting') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
