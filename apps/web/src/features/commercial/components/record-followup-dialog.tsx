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
  Label,
  Select,
  Textarea,
  Input,
} from '@erp/ui';

import type { FollowUpMethod } from '../lib/collection-events';
import type { ClientReceivableView } from '../lib/collection-view-model';
import { recordFollowUp } from '../api/commercial-api';
import { commercialKeys } from '../hooks/use-commercial';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: ClientReceivableView;
  projectId: string;
}

export function RecordFollowUpDialog({ open, onOpenChange, invoice, projectId }: Props) {
  const t = useTranslations('commercial.billing.collection.followUpDialog');
  const queryClient = useQueryClient();

  const [method, setMethod] = useState<FollowUpMethod | ''>('');
  const [contactPerson, setContactPerson] = useState('');
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      recordFollowUp(projectId, {
        invoiceId: invoice.invoiceId,
        method: method as FollowUpMethod,
        contactPerson: contactPerson.trim() || undefined,
        note: note.trim() || undefined,
        occurredAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commercialKeys.billing(projectId) });
      handleOpenChange(false);
    },
  });

  function reset() {
    setMethod('');
    setContactPerson('');
    setNote('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit() {
    if (!method) return;
    mutation.mutate();
  }

  const canSubmit = method !== '' && !mutation.isPending;

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
            <Label htmlFor="fu-method">{t('method')}</Label>
            <Select
              id="fu-method"
              value={method}
              onChange={(v) => setMethod(v as FollowUpMethod | '')}
            >
              <option value="">{t('methodRequired')}</option>
              <option value="WHATSAPP">{t('methods.WHATSAPP')}</option>
              <option value="EMAIL">{t('methods.EMAIL')}</option>
              <option value="PHONE">{t('methods.PHONE')}</option>
              <option value="PHYSICAL">{t('methods.PHYSICAL')}</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-contact">{t('contactPerson')}</Label>
            <Input
              id="fu-contact"
              type="text"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              placeholder={t('contactPersonPlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-note">{t('note')}</Label>
            <Textarea
              id="fu-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              rows={3}
            />
          </div>

          {mutation.isError ? (
            <p className="text-caption text-danger">
              {mutation.error instanceof Error ? mutation.error.message : t('saveError')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="default" onClick={handleSubmit} disabled={!canSubmit}>
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
