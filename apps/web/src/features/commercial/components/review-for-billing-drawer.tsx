'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@erp/ui';
import { CheckCircle2, TriangleAlert } from 'lucide-react';

import { formatMoney } from '@/lib/format';

import type { MilestoneItemViewModel } from '../milestone-journey.adapter';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ReviewForBillingDrawerProps {
  milestone: MilestoneItemViewModel | null;
  currency: string;
  financialsVisible: boolean;
  contractIsActive: boolean;
  /**
   * Count of outstanding invoices on the contract.
   * Shown as a warning (informational only — does NOT block the CTA).
   */
  outstandingInvoiceCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user clicks "Mark ready to bill". Resolves only after persistence succeeds. */
  onMarkReadyToBill: (installmentId: string) => Promise<void>;
  isPending?: boolean;
  errorMessage?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReviewForBillingDrawer({
  milestone,
  currency,
  financialsVisible,
  contractIsActive,
  outstandingInvoiceCount,
  open,
  onOpenChange,
  onMarkReadyToBill,
  isPending = false,
  errorMessage,
}: ReviewForBillingDrawerProps) {
  const t = useTranslations('commercial.contractMilestones');
  const locale = useLocale() as 'en' | 'ar';

  async function handleMarkReady() {
    if (!milestone) return;
    try {
      await onMarkReadyToBill(milestone.id);
      onOpenChange(false);
    } catch {
      // The mutation error is rendered below; keep the drawer open for recovery.
    }
  }

  if (!milestone) return null;

  const checks = {
    milestoneVerified: milestone.programmeMilestone?.status === 'VERIFIED',
    contractActive: contractIsActive,
    noPriorInvoice:
      milestone.userState !== 'invoiced' &&
      milestone.userState !== 'partially-paid' &&
      milestone.userState !== 'paid',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          {t('review.title')}
        </DialogTitle>
        <DialogDescription className="text-body-sm text-muted-foreground">
          {t('review.subtitle')}
        </DialogDescription>

        <div className="space-y-5 py-2">
          {errorMessage ? <Alert variant="error" messages={[errorMessage]} /> : null}
          {/* Base amount */}
          {financialsVisible ? (
            <div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-body-sm text-muted-foreground">{t('review.baseAmount')}</span>
                <span className="text-body font-semibold tabular-nums text-foreground">
                  {milestone.baseAmount
                    ? (formatMoney(milestone.baseAmount, currency, locale) ?? milestone.baseAmount)
                    : '—'}
                </span>
              </div>

              {/* Variation allocations */}
              {milestone.variationAllocations.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-1.5 text-body-sm font-medium text-foreground">
                    {t('review.variationsTitle')}
                  </p>
                  <ul className="space-y-1.5">
                    {milestone.variationAllocations.map((vo) => (
                      <li
                        key={vo.variationId}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="min-w-0 text-body-sm">
                          <span className="font-mono text-xs text-muted-foreground">
                            {vo.reference}
                          </span>{' '}
                          {vo.title}
                        </span>
                        {vo.amount ? (
                          <span
                            className={`shrink-0 text-body-sm font-medium tabular-nums ${
                              vo.isOmission ? 'text-danger' : 'text-success'
                            }`}
                          >
                            {vo.isOmission ? '' : '+'}
                            {formatMoney(vo.amount, currency, locale) ?? vo.amount}
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {/* Expected billable total */}
                    {milestone.baseAmount ? (
                      <li className="flex items-center justify-between gap-4 border-t border-border pt-2">
                        <span className="text-body-sm font-medium text-foreground">
                          {t('review.total')}
                        </span>
                        <span className="shrink-0 text-body font-semibold tabular-nums text-foreground">
                          {computeTotal(milestone, currency, locale)}
                        </span>
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-body-sm text-muted-foreground">{t('review.noVariations')}</p>
              )}
            </div>
          ) : null}

          {/* Readiness checklist */}
          <div>
            <p className="mb-2 text-body-sm font-semibold text-foreground">{t('review.checksTitle')}</p>
            <ul className="space-y-1.5">
              <CheckItem
                checked={checks.milestoneVerified}
                label={t('review.checkMilestoneVerified')}
              />
              <CheckItem checked={checks.contractActive} label={t('review.checkContractActive')} />
              <CheckItem checked={checks.noPriorInvoice} label={t('review.checkNoInvoice')} />
            </ul>
          </div>

          {/* Prior unpaid invoice warning (informational only — does not block) */}
          {outstandingInvoiceCount > 0 ? (
            <Alert
              variant="warning"
              messages={[
                t('review.priorInvoiceWarning', { count: outstandingInvoiceCount }),
              ]}
            />
          ) : null}

        </div>

        <DialogFooter>
          <Button
            variant="default"
            onClick={() => void handleMarkReady()}
            disabled={isPending}
          >
            {t('review.markReadyToBill')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('review.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function CheckItem({ checked, label }: { checked: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-body-sm">
      {checked ? (
        <CheckCircle2 size={15} className="shrink-0 text-success" aria-hidden="true" />
      ) : (
        <TriangleAlert size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className={checked ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </li>
  );
}

function computeTotal(
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
