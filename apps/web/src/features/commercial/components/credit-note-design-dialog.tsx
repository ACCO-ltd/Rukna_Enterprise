'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle } from 'lucide-react';
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
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

import type { ClientReceivableView } from '../lib/collection-view-model';

// ─── Types ────────────────────────────────────────────────────────────────────

type CreditNoteReason = 'OMISSION' | 'PRICE_ERROR' | 'CORRECTION';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: ClientReceivableView;
  currency: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Design-only credit note dialog — no backend in Slice 6A.
 *
 * This shows the planned UX for credit note issuance. The form fields are live
 * (validatable) but the submit CTA is disabled with an explanation. The actual
 * accounting backend will be implemented in Slice 6B.
 *
 * Business rule (credit-after-invoice): A credit note reduces a client's outstanding
 * balance by formally crediting the disputed or adjusted amount. It is NOT the same
 * as cancelling the original invoice — the invoice remains on record.
 */
export function CreditNoteDesignDialog({ open, onOpenChange, invoice, currency }: Props) {
  const t = useTranslations('commercial.billing.collection.creditNoteDesign');
  const locale = useLocale() as 'en';

  const [reason, setReason] = useState<CreditNoteReason | ''>('');
  const [sourceVariation, setSourceVariation] = useState('');
  const [amount, setAmount] = useState('');

  const maxAmount = parseFloat(invoice.total ?? '0');
  const enteredAmount = parseFloat(amount) || 0;
  const amountValid = enteredAmount > 0 && enteredAmount <= maxAmount;

  function reset() {
    setReason('');
    setSourceVariation('');
    setAmount('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  const totalFormatted = invoice.total
    ? (formatMoney(invoice.total, currency, locale) ?? invoice.total)
    : null;
  const amountFormatted = amountValid
    ? (formatMoney(amount, currency, locale) ?? null)
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('title')}</DialogDescription>

        {/* 6A notice — backend not yet built */}
        <div className="flex items-start gap-2.5 rounded-control border border-warning/30 bg-warning/5 px-3 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <p className="text-caption text-warning">{t('notice')}</p>
        </div>

        <div className="space-y-4 py-2">
          {/* Original invoice (read-only) */}
          <div className="space-y-1.5">
            <Label>{t('originalInvoice')}</Label>
            <div className="flex items-center gap-3 rounded-control border border-border bg-surface-raised px-3 py-2 text-body-sm">
              <span className="font-medium">{invoice.invoiceNumber ?? '—'}</span>
              <span className="text-muted-foreground">{invoice.sourceLabel}</span>
              {totalFormatted ? (
                <span className="ms-auto shrink-0 font-medium tabular-nums">{totalFormatted}</span>
              ) : null}
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="cn-reason">{t('reason')}</Label>
            <Select
              id="cn-reason"
              value={reason}
              onChange={(v) => setReason(v as CreditNoteReason | '')}
            >
              <option value="">{t('reasonPlaceholder')}</option>
              <option value="OMISSION">{t('reasons.OMISSION')}</option>
              <option value="PRICE_ERROR">{t('reasons.PRICE_ERROR')}</option>
              <option value="CORRECTION">{t('reasons.CORRECTION')}</option>
            </Select>
          </div>

          {/* Source variation (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="cn-variation">{t('sourceVariation')}</Label>
            <Input
              id="cn-variation"
              type="text"
              value={sourceVariation}
              onChange={(e) => setSourceVariation(e.target.value)}
              placeholder={t('sourceVariationPlaceholder')}
            />
          </div>

          {/* Credit amount */}
          <div className="space-y-1.5">
            <Label htmlFor="cn-amount">{t('amount')}</Label>
            <Input
              id="cn-amount"
              type="number"
              min="0.01"
              max={invoice.total ?? undefined}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-caption text-muted-foreground">{t('amountNote')}</p>
          </div>

          {/* Draft preview */}
          {reason && amountFormatted ? (
            <div className="rounded-control border border-dashed border-border bg-surface-raised p-3">
              <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                Credit note preview
              </p>
              <div className="space-y-1 text-body-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('originalInvoice')}</span>
                  <span className="font-medium">{invoice.invoiceNumber ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('reason')}</span>
                  <span>{reason}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <span>Credit amount</span>
                  <span className="text-danger tabular-nums">−{amountFormatted}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {/* CTA is disabled — backend not yet available */}
          <div className="flex w-full flex-col gap-1">
            <Button variant="default" disabled>
              {t('cta')}
            </Button>
            <p className="text-center text-caption text-muted-foreground">
              {t('ctaDisabledHint')}
            </p>
          </div>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
