'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

import type { DisputeReason } from '../lib/collection-events';
import type { ClientReceivableView } from '../lib/collection-view-model';
import { openDispute } from '../api/commercial-api';
import { commercialKeys } from '../hooks/use-commercial';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: ClientReceivableView;
  currency: string;
  projectId: string;
}

export function OpenDisputeDialog({ open, onOpenChange, invoice, currency, projectId }: Props) {
  const t = useTranslations('commercial.billing.collection.disputeDialog');
  const locale = useLocale() as 'en';
  const queryClient = useQueryClient();

  const [reason, setReason] = useState<DisputeReason | ''>('');
  const [disputedAmount, setDisputedAmount] = useState('');
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      openDispute(projectId, {
        invoiceId: invoice.invoiceId,
        reason: reason as DisputeReason,
        disputedAmount: disputedAmount.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commercialKeys.billing(projectId) });
      handleOpenChange(false);
    },
  });

  function reset() {
    setReason('');
    setDisputedAmount('');
    setNote('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit() {
    if (!reason) return;
    mutation.mutate();
  }

  const outstandingFormatted = invoice.outstanding
    ? (formatMoney(invoice.outstanding, currency, locale) ?? invoice.outstanding)
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>
          {t('title')}
          {invoice.invoiceNumber ? ` — ${invoice.invoiceNumber}` : ''}
        </DialogTitle>
        <DialogDescription className="text-body-sm text-muted-foreground">
          {t('description')}
        </DialogDescription>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="dp-reason">{t('reason')}</Label>
            <Select
              id="dp-reason"
              value={reason}
              onChange={(v) => setReason(v as DisputeReason | '')}
            >
              <option value="">{t('reasonPlaceholder')}</option>
              <option value="OMISSION">{t('reasons.OMISSION')}</option>
              <option value="PRICE_ERROR">{t('reasons.PRICE_ERROR')}</option>
              <option value="WORK_NOT_ACCEPTED">{t('reasons.WORK_NOT_ACCEPTED')}</option>
              <option value="SCOPE_DISAGREEMENT">{t('reasons.SCOPE_DISAGREEMENT')}</option>
              <option value="OTHER">{t('reasons.OTHER')}</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dp-amount">
              {t('disputedAmount')}{' '}
              <span className="text-caption text-muted-foreground">({t('disputedAmountOptional')})</span>
            </Label>
            <Input
              id="dp-amount"
              type="number"
              min="0"
              step="0.01"
              value={disputedAmount}
              onChange={(e) => setDisputedAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dp-note">{t('note')}</Label>
            <Textarea
              id="dp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              rows={2}
            />
          </div>

          {/* Invariant note: outstanding balance is NOT adjusted by a dispute */}
          {outstandingFormatted ? (
            <p className="rounded-control bg-surface-raised px-3 py-2 text-caption text-muted-foreground">
              {t('outstandingNote')}
              {' '}
              <span className="font-medium tabular-nums">{outstandingFormatted}</span>
            </p>
          ) : null}

          {mutation.isError ? (
            <p className="text-caption text-danger">
              {mutation.error instanceof Error ? mutation.error.message : t('saveError')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="default" onClick={handleSubmit} disabled={!reason || mutation.isPending}>
            {mutation.isPending ? t('saving') : t('save')}
          </Button>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
