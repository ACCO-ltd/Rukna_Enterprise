'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  RadioGroup,
} from '@erp/ui';
import { CheckCircle2 } from 'lucide-react';

import { formatDate, formatMoney } from '@/lib/format';

import { recordPackageDelivery } from '../api/commercial-api';
import type { MilestoneItemViewModel } from '../milestone-journey.adapter';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeliveryMethod = 'whatsapp' | 'email' | 'physical' | 'other';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SendInvoiceDialogProps {
  open: boolean;
  milestone: MilestoneItemViewModel | null;
  projectId: string;
  currency: string;
  onSent: (installmentId: string, deliveryMethod: DeliveryMethod) => void;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SendInvoiceDialog({
  open,
  milestone,
  projectId,
  currency,
  onSent,
  onClose,
}: SendInvoiceDialogProps) {
  const t = useTranslations('commercial.contractMilestones.sendInvoice');
  const locale = useLocale() as 'en';

  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | ''>('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleMarkSent() {
    if (!milestone || !deliveryMethod) return;
    setIsPending(true);
    setErrorMessage(null);
    try {
      await recordPackageDelivery(projectId, milestone.id, {
        method: deliveryMethod.toUpperCase() as 'WHATSAPP' | 'EMAIL' | 'PHYSICAL' | 'OTHER',
        sentAt: new Date().toISOString(),
        recipient: recipient.trim() || undefined,
        note: note.trim() || undefined,
      });
      onSent(milestone.id, deliveryMethod);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not record delivery. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setDeliveryMethod('');
      setRecipient('');
      setNote('');
      setErrorMessage(null);
      onClose();
    }
  }

  if (!milestone) return null;

  const journey = milestone.invoiceJourney;
  const total =
    milestone.baseAmount
      ? (
          Number(milestone.baseAmount) +
          milestone.variationAllocations.reduce(
            (sum, vo) => sum + (vo.amount ? Number(vo.amount) : 0),
            0,
          )
        ).toFixed(2)
      : null;

  const totalWithVat = total ? (Number(total) * 1.05).toFixed(2) : null;
  const fmtTotal = totalWithVat ? (formatMoney(totalWithVat, currency, locale) ?? totalWithVat) : null;
  const fmtDue =
    journey?.dueDate ? (formatDate(journey.dueDate, locale) ?? journey.dueDate) : null;

  const summaryLine =
    fmtTotal && fmtDue
      ? t('totalDue', { total: fmtTotal, date: fmtDue })
      : fmtTotal
        ? t('totalNoDue', { total: fmtTotal })
        : null;

  const deliveryOptions = [
    { value: 'whatsapp' as const, label: t('whatsapp') },
    { value: 'email' as const, label: t('email') },
    { value: 'physical' as const, label: t('physical') },
    { value: 'other' as const, label: t('other') },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="send-invoice-desc">
        {/* Eyebrow */}
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-success" aria-hidden="true" />
          <span className="text-body-sm font-semibold text-success">{t('eyebrow')}</span>
        </div>

        <DialogTitle className="mt-1">{t('title')}</DialogTitle>
        <DialogDescription id="send-invoice-desc" className="text-body-sm text-muted-foreground">
          {summaryLine}
        </DialogDescription>

        <div className="space-y-5 py-1">
          {errorMessage ? (
            <Alert variant="error" messages={[errorMessage]} role="alert" />
          ) : null}

          {/* Delivery method */}
          <RadioGroup
            label={t('method')}
            name="delivery-method"
            value={deliveryMethod}
            onChange={(v) => setDeliveryMethod(v as DeliveryMethod)}
            options={deliveryOptions}
            orientation="vertical"
            description={!deliveryMethod ? t('methodRequired') : undefined}
          />

          {/* Recipient */}
          <div className="space-y-1">
            <label
              htmlFor="si-recipient"
              className="text-body-sm font-medium text-foreground"
            >
              {t('recipient')}
            </label>
            <input
              id="si-recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={t('recipientPlaceholder')}
              disabled={isPending}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>

          {/* Note */}
          <div className="space-y-1">
            <label htmlFor="si-note" className="text-body-sm font-medium text-foreground">
              {t('note')}
            </label>
            <textarea
              id="si-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              rows={2}
              disabled={isPending}
              className="block w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-body-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('sendLater')}
          </Button>
          <Button
            variant="default"
            onClick={handleMarkSent}
            disabled={!deliveryMethod || isPending}
          >
            {isPending ? t('sending') : t('markSent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
