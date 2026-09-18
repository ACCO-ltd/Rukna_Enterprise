'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@erp/ui';
import type { CommercialSummaryResponse } from '@erp/types';
import { useQueryClient } from '@tanstack/react-query';

import { formatMoney } from '@/lib/format';
import { issuePackage } from '../api/commercial-api';
import { commercialKeys } from '../hooks/use-commercial';

import type { InvoiceJourneyPhase, MilestoneItemViewModel } from '../milestone-journey.adapter';
import { InvoicePreviewPanel } from './invoice-preview-panel';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PrepareInvoiceDialogProps {
  open: boolean;
  milestone: MilestoneItemViewModel | null;
  summary: CommercialSummaryResponse;
  onInvoiceIssued: (installmentId: string, journey: InvoiceJourneyPhase) => void;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PrepareInvoiceDialog({
  open,
  milestone,
  summary,
  onInvoiceIssued,
  onClose,
}: PrepareInvoiceDialogProps) {
  const queryClient = useQueryClient();
  const t = useTranslations('commercial.contractMilestones.prepareInvoice');
  const locale = useLocale() as 'en';
  const currency = summary.currency ?? summary.mainContract?.currency ?? 'USD';
  const clientName = summary.mainContract?.clientName ?? '—';
  const orgName = 'ACCO Ltd'; // TODO: read from org profile when available

  const today = new Date().toISOString().slice(0, 10);

  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedVoIds, setSelectedVoIds] = useState<Set<string>>(
    new Set(milestone?.variationAllocations.map((vo) => vo.variationId) ?? []),
  );
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggleVo(voId: string) {
    setSelectedVoIds((prev) => {
      const next = new Set(prev);
      if (next.has(voId)) {
        next.delete(voId);
      } else {
        next.add(voId);
      }
      return next;
    });
  }

  async function handleIssue() {
    if (!milestone || !dueDate || !summary.mainContract?.id) return;
    setIsPending(true);
    setErrorMessage(null);
    try {
      const pkg = await issuePackage(summary.projectId, milestone.id, {
        invoiceDate,
        dueDate,
        paymentTerms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        selectedVariationIds: [...selectedVoIds],
      });
      await queryClient.invalidateQueries({ queryKey: commercialKeys.all(summary.projectId) });
      const invoiceId = pkg.milestoneInvoice?.id ?? milestone.id;
      onInvoiceIssued(milestone.id, {
        phase: 'issued',
        invoiceId,
        invoiceDate,
        dueDate,
        documents: pkg.documents,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not issue the invoice. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsPending(false);
    }
  }

  if (!milestone) return null;

  const fmt = (amount: string | null) =>
    amount ? (formatMoney(amount, currency, locale) ?? amount) : '—';

  const canIssue = Boolean(dueDate) && !isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-5xl" aria-describedby="prepare-invoice-desc">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription id="prepare-invoice-desc" className="text-body-sm text-muted-foreground">
          {t('subtitle')}
        </DialogDescription>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Left: form ─────────────────────────────────────────────────── */}
          <div className="space-y-5 overflow-y-auto">
            {/* Error */}
            {errorMessage ? (
              <Alert variant="error" messages={[errorMessage]} role="alert" />
            ) : null}

            {/* Client + source */}
            <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
              <FieldRow label={t('client')}>{clientName}</FieldRow>
              <FieldRow label={t('billingSource')}>
                {milestone.name} · {fmtPercent(milestone.percentage)}
              </FieldRow>
              {summary.financialsVisible ? (
                <FieldRow label={t('baseAmount')}>{fmt(milestone.baseAmount)}</FieldRow>
              ) : null}
            </div>

            {/* Variation allocations */}
            {summary.financialsVisible ? (
              <div>
                <p className="mb-1.5 text-body-sm font-medium text-foreground">
                  {t('variationsTitle')}
                </p>
                {milestone.variationAllocations.length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">{t('noVariations')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    <li>
                      <p className="text-caption text-muted-foreground">{t('variationNote')}</p>
                    </li>
                    {milestone.variationAllocations.map((vo) => (
                      <li key={vo.variationId} className="flex items-center gap-3">
                        <Checkbox
                          id={`vo-${vo.variationId}`}
                          checked={selectedVoIds.has(vo.variationId)}
                          onChange={() => toggleVo(vo.variationId)}
                          disabled={isPending}
                          aria-label={`${vo.reference} ${vo.title}`}
                        />
                        <label
                          htmlFor={`vo-${vo.variationId}`}
                          className="flex flex-1 cursor-pointer items-baseline justify-between gap-4 text-body-sm"
                        >
                          <span className="min-w-0">
                            <span className="font-mono text-xs text-muted-foreground">
                              {vo.reference}
                            </span>{' '}
                            {vo.title}
                          </span>
                          {vo.amount ? (
                            <span
                              className={`shrink-0 tabular-nums ${
                                vo.isOmission ? 'text-destructive' : 'text-success'
                              }`}
                            >
                              {vo.isOmission ? '' : '+'}
                              {fmt(vo.amount)}
                            </span>
                          ) : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Computed totals */}
                <ComputedTotals
                  milestone={milestone}
                  selectedVoIds={selectedVoIds}
                  currency={currency}
                  locale={locale}
                />
              </div>
            ) : null}

            {/* Divider */}
            <div className="border-t border-border" />

            {/* Invoice date */}
            <div className="space-y-1">
              <label htmlFor="pi-invoice-date" className="text-body-sm font-medium text-foreground">
                {t('invoiceDate')}
              </label>
              <input
                id="pi-invoice-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                disabled={isPending}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                required
              />
            </div>

            {/* Due date */}
            <div className="space-y-1">
              <label htmlFor="pi-due-date" className="text-body-sm font-medium text-foreground">
                {t('dueDate')}{' '}
                <span className="text-caption text-muted-foreground">
                  ({t('dueDateRequired')})
                </span>
              </label>
              <input
                id="pi-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={isPending}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                aria-required="true"
              />
            </div>

            {/* Payment terms */}
            <div className="space-y-1">
              <label
                htmlFor="pi-payment-terms"
                className="text-body-sm font-medium text-foreground"
              >
                {t('paymentTerms')}
              </label>
              <input
                id="pi-payment-terms"
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder={t('paymentTermsPlaceholder')}
                maxLength={100}
                disabled={isPending}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <label htmlFor="pi-notes" className="text-body-sm font-medium text-foreground">
                {t('notes')}
              </label>
              <textarea
                id="pi-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('notesPlaceholder')}
                rows={3}
                disabled={isPending}
                className="block w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-body-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>
          </div>

          {/* ── Right: live preview ─────────────────────────────────────────── */}
          <div className="hidden lg:block">
            <InvoicePreviewPanel
              milestone={milestone}
              clientName={clientName}
              orgName={orgName}
              currency={currency}
              invoiceDate={invoiceDate}
              dueDate={dueDate}
              paymentTerms={paymentTerms}
              notes={notes}
              selectedVoIds={selectedVoIds}
              isIssued={false}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('cancel')}
          </Button>
          <Button
            variant="default"
            onClick={handleIssue}
            disabled={!canIssue}
            aria-label={t('issueCta')}
          >
            {t('issueCta')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-body-sm text-muted-foreground">{label}</span>
      <span className="text-end text-body-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

function ComputedTotals({
  milestone,
  selectedVoIds,
  currency,
  locale,
}: {
  milestone: MilestoneItemViewModel;
  selectedVoIds: Set<string>;
  currency: string;
  locale: 'en';
}) {
  const t = useTranslations('commercial.contractMilestones.prepareInvoice');

  const fmt = (n: number) => formatMoney(n.toFixed(2), currency, locale) ?? n.toFixed(2);

  const base = milestone.baseAmount ? Number(milestone.baseAmount) : 0;
  const voTotal = milestone.variationAllocations
    .filter((vo) => selectedVoIds.has(vo.variationId))
    .reduce((sum, vo) => sum + (vo.amount ? Number(vo.amount) : 0), 0);

  const subtotal = base + voTotal;
  const vat = subtotal * 0.05;
  const total = subtotal + vat;

  return (
    <div className="mt-4 space-y-1 rounded-lg bg-surface px-4 py-3">
      <TotalLine label={t('subtotal')} value={fmt(subtotal)} />
      <TotalLine label={t('vat')} value={fmt(vat)} />
      <div className="border-t border-border pt-1.5">
        <TotalLine label={t('total')} value={fmt(total)} bold />
      </div>
    </div>
  );
}

function TotalLine({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={`text-body-sm ${bold ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
      <span className={`shrink-0 tabular-nums text-body-sm ${bold ? 'font-bold text-foreground' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}

function fmtPercent(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(n);
}
