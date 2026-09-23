'use client';

import { useLocale, useTranslations } from 'next-intl';

import { formatDate, formatMoney } from '@/lib/format';

import type { MilestoneItemViewModel } from '../milestone-journey.adapter';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface InvoicePreviewPanelProps {
  milestone: MilestoneItemViewModel;
  clientName: string;
  orgName: string;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  notes: string;
  selectedVoIds: Set<string>;
  isIssued?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InvoicePreviewPanel({
  milestone,
  clientName,
  orgName,
  currency,
  invoiceDate,
  dueDate,
  paymentTerms,
  notes,
  selectedVoIds,
  isIssued = false,
}: InvoicePreviewPanelProps) {
  const t = useTranslations('commercial.contractMilestones.prepareInvoice');
  const locale = useLocale() as 'en';

  const fmt = (amount: string | null) =>
    amount ? (formatMoney(amount, currency, locale) ?? amount) : '—';

  const fmtDate = (d: string) => (d ? (formatDate(d, locale) ?? d) : '—');

  const base = milestone.baseAmount ? Number(milestone.baseAmount) : 0;

  const selectedVos = milestone.variationAllocations.filter((vo) =>
    selectedVoIds.has(vo.variationId),
  );

  const voTotal = selectedVos.reduce((sum, vo) => sum + (vo.amount ? Number(vo.amount) : 0), 0);
  const subtotal = base + voTotal;
  const vat = subtotal * 0.05;
  const total = subtotal + vat;

  // ─── Billing package view (when VOs are present) ──────────────────────────

  const hasVos = selectedVos.length > 0;
  const docCount = 1 + selectedVos.length;

  // ─── Status bar ───────────────────────────────────────────────────────────

  const statusBar = (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
      {isIssued ? (
        <span className="rounded-md bg-success/10 px-2.5 py-1 text-caption font-semibold uppercase tracking-wide text-success">
          {t('invoiceCreatedBadge')}
        </span>
      ) : (
        <span className="rounded-md bg-amber-100 px-2.5 py-1 text-caption font-semibold uppercase tracking-wide text-amber-800">
          {t('draftPreviewTitle')}
        </span>
      )}
    </div>
  );

  // ─── Shared header (org, client, dates) ───────────────────────────────────

  const invoiceHeader = (
    <>
      <div className="flex items-start justify-between gap-4">
        <p className="text-body-sm font-semibold text-foreground">{orgName}</p>
        <div className="text-end space-y-0.5">
          <p className="text-body-sm font-bold text-foreground">
            {isIssued ? t('invoiceCreatedBadge') : t('draftPreviewTitle')}
          </p>
          <p className="text-caption text-muted-foreground">
            {invoiceDate ? fmtDate(invoiceDate) : '—'}
          </p>
        </div>
      </div>

      <div>
        <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {t('client')}
        </p>
        <p className="mt-0.5 text-body-sm font-medium text-foreground">{clientName}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 border-b border-border pb-4">
        <div>
          <p className="text-caption text-muted-foreground">{t('invoiceDate')}</p>
          <p className="text-body-sm font-medium text-foreground">
            {invoiceDate ? fmtDate(invoiceDate) : '—'}
          </p>
        </div>
        <div>
          <p className="text-caption text-muted-foreground">{t('dueDate')}</p>
          <p className="text-body-sm font-medium text-foreground">
            {dueDate ? fmtDate(dueDate) : <span className="text-muted-foreground">—</span>}
          </p>
        </div>
      </div>
    </>
  );

  // ─── Billing package layout ───────────────────────────────────────────────

  if (hasVos) {
    const milestoneSubtotal = base;
    const milestoneVat = milestoneSubtotal * 0.05;
    const milestoneTotal = milestoneSubtotal + milestoneVat;

    return (
      <div
        className="flex h-full flex-col overflow-y-auto rounded-lg border border-border bg-white"
        aria-label={t('billingPackageLabel')}
      >
        {statusBar}

        <div className="flex-1 space-y-5 p-5">
          {invoiceHeader}

          {/* Package header */}
          <div className="rounded-lg bg-surface px-4 py-2.5">
            <p className="text-body-sm font-semibold text-foreground">
              {t('billingPackageTitle')}
            </p>
            <p className="text-caption text-muted-foreground">
              {t('billingPackageDocCount', { count: docCount })}
            </p>
          </div>

          {/* BASE MILESTONE document card */}
          <div className="rounded-lg border border-border bg-white p-4 space-y-2">
            <div>
              <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {t('billingPackageBaseMilestone')}
              </p>
              <p className="text-body-sm text-muted-foreground">{t('draftInvoiceLabel')}</p>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-body-sm font-medium text-foreground">{milestone.name}</span>
              <span className="shrink-0 text-body-sm tabular-nums text-foreground">
                {fmt(milestoneSubtotal.toFixed(2))}
              </span>
            </div>
          </div>

          {/* VO document cards */}
          {selectedVos.map((vo) => {
            const voAmt = vo.amount ? Number(vo.amount) : 0;
            return (
              <div key={vo.variationId} className="rounded-lg border border-border bg-white p-4 space-y-2">
                <div>
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('billingPackageVariation')}
                  </p>
                  <p className="text-body-sm text-muted-foreground">{t('draftInvoiceLabel')}</p>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-body-sm font-medium text-foreground">
                    <span className="font-mono text-xs text-muted-foreground">{vo.reference}</span>{' '}
                    — {vo.title}
                  </span>
                  <span
                    className={`shrink-0 text-body-sm tabular-nums ${
                      vo.isOmission ? 'text-danger' : 'text-success'
                    }`}
                  >
                    {fmt(voAmt.toFixed(2))}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Package totals */}
          <div className="space-y-1 border-t border-border pt-3">
            <TotalRow label={t('packageSubtotal')} value={fmt(subtotal.toFixed(2))} />
            <TotalRow label={t('vat')} value={fmt(vat.toFixed(2))} />
            <div className="border-t border-border pt-1.5">
              <TotalRow label={t('packageTotal')} value={fmt(total.toFixed(2))} bold />
            </div>
          </div>

          {/* Payment terms + notes */}
          {paymentTerms ? (
            <div>
              <p className="text-caption text-muted-foreground">{t('paymentTerms')}</p>
              <p className="text-body-sm text-foreground">{paymentTerms}</p>
            </div>
          ) : null}
          {notes ? (
            <div>
              <p className="text-caption text-muted-foreground">{t('notes')}</p>
              <p className="text-body-sm text-foreground">{notes}</p>
            </div>
          ) : null}
        </div>

        <div className="border-t border-border px-5 py-3">
          <p className="text-caption text-muted-foreground">
            {isIssued ? t('invoiceNumberNote') : t('draftPreviewNote')}
          </p>
        </div>
      </div>
    );
  }

  // ─── Single invoice layout (no VOs) ──────────────────────────────────────

  return (
    <div
      className="flex h-full flex-col overflow-y-auto rounded-lg border border-border bg-white"
      aria-label={isIssued ? t('invoiceCreatedBadge') : t('draftPreviewTitle')}
    >
      {statusBar}

      <div className="flex-1 space-y-5 p-5">
        {invoiceHeader}

        {/* Line items */}
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 text-body-sm text-foreground font-medium">
              {milestone.name}
            </span>
            <span className="shrink-0 text-body-sm tabular-nums text-foreground">
              {fmt(milestone.baseAmount)}
            </span>
          </div>

          <div className="mt-3 space-y-1 border-t border-border pt-3">
            <TotalRow label={t('subtotal')} value={fmt(subtotal.toFixed(2))} />
            <TotalRow label={t('vat')} value={fmt(vat.toFixed(2))} />
            <div className="border-t border-border pt-1.5">
              <TotalRow label={t('total')} value={fmt(total.toFixed(2))} bold />
            </div>
          </div>
        </div>

        {paymentTerms ? (
          <div>
            <p className="text-caption text-muted-foreground">{t('paymentTerms')}</p>
            <p className="text-body-sm text-foreground">{paymentTerms}</p>
          </div>
        ) : null}

        {notes ? (
          <div>
            <p className="text-caption text-muted-foreground">{t('notes')}</p>
            <p className="text-body-sm text-foreground">{notes}</p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-5 py-3">
        {isIssued ? (
          <p className="text-caption text-muted-foreground">{t('invoiceNumberNote')}</p>
        ) : (
          <p className="text-caption text-muted-foreground">{t('draftPreviewNote')}</p>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function TotalRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={`text-body-sm ${bold ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
      <span className={`shrink-0 tabular-nums ${bold ? 'text-body font-bold text-foreground' : 'text-body-sm text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}
