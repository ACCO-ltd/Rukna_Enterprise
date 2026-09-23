'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
  Textarea,
} from '@erp/ui';

import type { ClientReceivableView } from '../lib/collection-view-model';
import { recordPromise } from '../api/commercial-api';
import { commercialKeys } from '../hooks/use-commercial';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: ClientReceivableView;
  projectId: string;
}

export function RecordPromiseDialog({ open, onOpenChange, invoice, projectId }: Props) {
  const t = useTranslations('commercial.billing.collection.promiseDialog');
  const queryClient = useQueryClient();

  const [promisedDate, setPromisedDate] = useState('');
  const [promisedAmount, setPromisedAmount] = useState('');
  const [note, setNote] = useState('');
  const [dateError, setDateError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      recordPromise(projectId, {
        invoiceId: invoice.invoiceId,
        promisedDate,
        promisedAmount: promisedAmount.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commercialKeys.billing(projectId) });
      handleOpenChange(false);
    },
  });

  function reset() {
    setPromisedDate('');
    setPromisedAmount('');
    setNote('');
    setDateError('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit() {
    if (!promisedDate) {
      setDateError(t('promisedDateRequired'));
      return;
    }
    mutation.mutate();
  }

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
            <Label htmlFor="pr-date">{t('promisedDate')}</Label>
            <Input
              id="pr-date"
              type="date"
              value={promisedDate}
              onChange={(e) => {
                setPromisedDate(e.target.value);
                setDateError('');
              }}
            />
            {dateError ? <p className="text-caption text-danger">{dateError}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-amount">
              {t('promisedAmount')}{' '}
              <span className="text-caption text-muted-foreground">({t('promisedAmountOptional')})</span>
            </Label>
            <Input
              id="pr-amount"
              type="number"
              min="0"
              step="0.01"
              value={promisedAmount}
              onChange={(e) => setPromisedAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-note">{t('note')}</Label>
            <Textarea
              id="pr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              rows={2}
            />
          </div>

          {/* Invariant note: contractual due date is never changed by a promise */}
          <p className="rounded-control bg-surface-raised px-3 py-2 text-caption text-muted-foreground">
            {t('dueDateNote')}
          </p>

          {mutation.isError ? (
            <p className="text-caption text-danger">
              {mutation.error instanceof Error ? mutation.error.message : t('saveError')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="default" onClick={handleSubmit} disabled={!promisedDate || mutation.isPending}>
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
