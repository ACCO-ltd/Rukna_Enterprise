'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@erp/ui';
import { CheckCircle2, Clock } from 'lucide-react';

import { formatDate, formatMoney } from '@/lib/format';

import type { MilestoneItemViewModel } from '../milestone-journey.adapter';

function fmtPercent(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(n);
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface MilestoneDetailPanelProps {
  milestone: MilestoneItemViewModel | null;
  currency: string;
  financialsVisible: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReviewForBilling?: (milestone: MilestoneItemViewModel) => void;
  onPrepareInvoice?: (milestone: MilestoneItemViewModel) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MilestoneDetailPanel({
  milestone,
  currency,
  financialsVisible,
  open,
  onOpenChange,
  onReviewForBilling,
  onPrepareInvoice,
}: MilestoneDetailPanelProps) {
  const t = useTranslations('commercial.contractMilestones');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {milestone ? (
          <>
            <DialogTitle>
              {milestone.name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('detail.title')}
            </DialogDescription>

            <div className="space-y-5 py-2">
              {/* Percentage + base amount */}
              <div className="flex items-center justify-between gap-4">
                <span className="text-body-sm text-muted-foreground">
                  {t('detail.percentage', {
                    percent: fmtPercent(milestone.percentage),
                  })}
                </span>
                {financialsVisible && milestone.baseAmount ? (
                  <span className="text-body font-semibold tabular-nums text-foreground">
                    {formatMoney(milestone.baseAmount, currency, locale) ?? milestone.baseAmount}
                  </span>
                ) : null}
              </div>

              {/* Date */}
              {milestone.dateLabel && milestone.expectedDate ? (
                <Row
                  label={
                    milestone.dateLabel === 'due'
                      ? t('detail.dueDate')
                      : t('detail.expectedDate')
                  }
                >
                  {formatDate(milestone.expectedDate, locale) ?? milestone.expectedDate}
                </Row>
              ) : (
                <Row label={t('detail.expectedDate')}>
                  <span className="text-muted-foreground">{t('detail.noDate')}</span>
                </Row>
              )}

              {/* Programme milestone */}
              <Row label={t('detail.linkedMilestone')}>
                {milestone.triggerType === 'ADVANCE' ? (
                  <span className="text-muted-foreground">{t('milestone.advance')}</span>
                ) : milestone.programmeMilestone ? (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">
                      {t('milestone.linked', {
                        code: milestone.programmeMilestone.code,
                        name: milestone.programmeMilestone.name,
                      })}
                    </span>
                    {milestone.programmeMilestone.status === 'VERIFIED' ? (
                      <Badge tone="live" className="gap-1">
                        <CheckCircle2 size={11} aria-hidden="true" />
                        {t('milestone.verified')}
                      </Badge>
                    ) : (
                      <Badge tone="neutral" className="gap-1">
                        <Clock size={11} aria-hidden="true" />
                        {t('milestone.planned')}
                      </Badge>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('detail.noMilestoneLink')}</span>
                )}
              </Row>

              {/* Commercial state */}
              <Row label={t('detail.commercialState')}>
                <span className="capitalize">{t(`state.${milestone.userState}`)}</span>
              </Row>

              {/* Variation allocations */}
              {financialsVisible ? (
                <div>
                  <p className="mb-2 text-body-sm font-medium text-foreground">
                    {t('detail.variations')}
                  </p>
                  {milestone.variationAllocations.length === 0 ? (
                    <p className="text-body-sm text-muted-foreground">
                      {t('detail.noVariations')}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {milestone.variationAllocations.map((vo) => (
                        <li key={vo.variationId} className="flex items-center justify-between gap-4">
                          <span className="min-w-0 text-body-sm text-foreground">
                            <span className="font-mono text-xs text-muted-foreground">
                              {vo.reference}
                            </span>{' '}
                            {vo.title}
                          </span>
                          {vo.amount ? (
                            <span
                              className={`shrink-0 text-body-sm font-medium tabular-nums ${
                                vo.isOmission ? 'text-destructive' : 'text-success'
                              }`}
                            >
                              {vo.isOmission ? '' : '+'}
                              {formatMoney(vo.amount, currency, locale) ?? vo.amount}
                            </span>
                          ) : null}
                        </li>
                      ))}
                      {/* Total line */}
                      {milestone.baseAmount ? (
                        <li className="flex items-center justify-between gap-4 border-t border-border pt-2">
                          <span className="text-body-sm font-medium text-foreground">
                            {t('journey.expectedBilling')}
                          </span>
                          <span className="shrink-0 text-body font-semibold tabular-nums text-foreground">
                            {computeExpectedBilling(milestone, currency, locale)}
                          </span>
                        </li>
                      ) : null}
                    </ul>
                  )}
                </div>
              ) : null}

              {/* Invoice ref (future Slice 3B) */}
              {(milestone.userState === 'invoiced' ||
                milestone.userState === 'partially-paid' ||
                milestone.userState === 'paid') ? (
                <Row label={t('detail.invoiceRef')}>
                  <span className="text-muted-foreground">
                    {milestone.invoiceReference ?? t('detail.invoiceRefNotSet')}
                  </span>
                </Row>
              ) : null}
            </div>

            <DialogFooter>
              {milestone.userState === 'review-for-billing' && onReviewForBilling ? (
                <Button
                  variant="default"
                  onClick={() => {
                    onOpenChange(false);
                    onReviewForBilling(milestone);
                  }}
                >
                  {t('detail.reviewCta')}
                </Button>
              ) : (milestone.userState === 'ready-to-bill' || milestone.userState === 'invoice-issued') && onPrepareInvoice ? (
                <Button
                  variant="default"
                  onClick={() => {
                    onOpenChange(false);
                    onPrepareInvoice(milestone);
                  }}
                >
                  {milestone.userState === 'invoice-issued'
                    ? t('cta.sendToClient')
                    : t('cta.prepareInvoice')}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('cta.openDetail') /* "View details" repurposed as dismiss */}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-body-sm text-muted-foreground">{label}</dt>
      <dd className="text-end text-body-sm text-foreground">{children}</dd>
    </div>
  );
}

function computeExpectedBilling(
  milestone: MilestoneItemViewModel,
  currency: string,
  locale: 'en' | 'ar',
): string {
  if (!milestone.baseAmount) return '—';
  const base = Number(milestone.baseAmount);
  const voTotal = milestone.variationAllocations.reduce((sum, vo) => {
    return sum + (vo.amount ? Number(vo.amount) : 0);
  }, 0);
  const total = (base + voTotal).toFixed(2);
  return formatMoney(total, currency, locale) ?? total;
}
