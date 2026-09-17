'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  DefinitionList,
  DefinitionRow,
  Label,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Skeleton,
  Textarea,
  useToast,
} from '@erp/ui';
import type { VariationOrderResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { useReverseVariation, useVariation } from '../hooks/use-commercial';
import { variationStatusTone } from '../presentation';
import { VariationBillingChip, type VariationBilling } from './variation-billing-chip';

/**
 * VariationOrder detail, in a drawer so the list stays behind it.
 *
 * variation-collapse: a variation is now raised straight to CLIENT_APPROVED + adopted-to-BOQ in one
 * step (via the BOQ "Add Extra Work" drawer), and the approval workflow is gone — so this sheet is a
 * read-only ledger of the variation, its lines and its billing status. The one operative command it
 * offers is **Reverse**: un-adopting an adopted, still-unbilled variation (lowering the contract
 * value and removing its BOQ scope). Reversibility is a server rule (a 409 otherwise); the UI shows
 * the affordance only when the coarse permission + adopted-status preconditions hold and surfaces the
 * server's verdict verbatim.
 *
 * The screen renders only server figures: the net price is `VariationOrderResponse.netPrice`, and a
 * successful reverse re-reads from the server. Governance/precondition (409) failures surface inline
 * in the confirm dialog, never a crash.
 */
export function VariationDetailSheet({
  variationId,
  contractId,
  projectId,
  currency,
  billing,
  canReverse,
  open,
  onOpenChange,
}: {
  variationId: string | null;
  contractId: string;
  projectId: string;
  currency: string | null;
  /** The VO's billing allocation from the list's Billing Packages read, so the detail can show
   *  where it was billed without a second query. Null when unbilled or opened right after create. */
  billing: VariationBilling | null;
  /** `capabilities.canReverseVariation` from the commercial summary — the coarse permission gate. */
  canReverse: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('commercial.variations');
  const query = useVariation(open ? variationId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" aria-describedby="vo-detail-desc">
        {query.isPending ? (
          <div className="space-y-3 p-5" role="status" aria-live="polite">
            <span className="sr-only">{t('detail.loading')}</span>
            <Skeleton className="h-8 w-2/3" aria-hidden="true" />
            <Skeleton className="h-24 w-full" aria-hidden="true" />
            <Skeleton className="h-40 w-full" aria-hidden="true" />
          </div>
        ) : query.isError || !query.data ? (
          <div className="p-5">
            <DialogTitle>{t('detail.loadFailed')}</DialogTitle>
            <DialogDescription id="vo-detail-desc" className="mt-1">
              {t('detail.loadFailedHint')}
            </DialogDescription>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
              {t('detail.retry')}
            </Button>
          </div>
        ) : (
          // Keyed by status so a reverse remounts the body fresh — the inline confirm form resets
          // without a setState-in-effect.
          <DetailBody
            key={query.data.status}
            variation={query.data}
            contractId={contractId}
            projectId={projectId}
            currency={currency}
            billing={billing}
            canReverse={canReverse}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  variation,
  contractId,
  projectId,
  currency,
  billing,
  canReverse,
  onDone,
}: {
  variation: VariationOrderResponse;
  contractId: string;
  projectId: string;
  currency: string | null;
  billing: VariationBilling | null;
  canReverse: boolean;
  onDone: () => void;
}) {
  const t = useTranslations('commercial.variations');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { toast } = useToast();

  const reverse = useReverseVariation(variation.id, contractId, projectId);

  // The confirm form is an inline sub-state so the drawer never navigates away mid-decision. The
  // 409 precondition failure ("already billed", "not adopted") is shown in place, not as a toast.
  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [serverError, setServerError] = React.useState<string | null>(null);

  const money = (value: string | number | null) =>
    formatMoney(value, currency, locale) ?? t('detail.notSet');

  const isApproved = variation.status === 'CLIENT_APPROVED';
  const isOmission = Number(variation.netPrice) < 0;
  const showImpact = isApproved || variation.appliedToBoq || billing !== null;

  // The reverse affordance is shown only for an adopted, client-approved VO (the sole reversible
  // shape) AND when the caller holds the coarse permission. It is NOT shown once billed — but the
  // "already billed" case is only fully known server-side, so a 409 there is surfaced on confirm.
  const isBilled = billing?.invoice != null;
  const canOfferReverse = canReverse && isApproved && variation.appliedToBoq && !isBilled;

  function runReverse() {
    setServerError(null);
    reverse.mutate(
      { reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: t('toast.reversed'), tone: 'success' });
          onDone();
        },
        onError: (error) => setServerError(errorMessage(error, t('toast.reverseFailed'))),
      },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-caption text-muted-foreground">{variation.reference}</code>
          <Badge tone={variationStatusTone(variation.status)}>
            {t(`status.${variation.status}`)}
          </Badge>
        </div>
        <DialogTitle className="mt-1.5">{variation.title}</DialogTitle>
        <DialogDescription id="vo-detail-desc" className="mt-1">
          {t('detail.subtitle')}
        </DialogDescription>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {variation.description ? (
          <p className="text-body-sm text-foreground">{variation.description}</p>
        ) : null}

        <section>
          <h3 className="mb-2 text-body-sm font-semibold text-foreground">
            {t('detail.linesTitle')}
          </h3>
          {variation.lines.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t('detail.noLines')}</p>
          ) : (
            <ul className="divide-y divide-border/70 rounded-control border border-border">
              {variation.lines.map((line) => (
                <li key={line.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm text-foreground">{line.description}</p>
                    <p className="text-caption tabular-nums text-muted-foreground">
                      {line.quantity} × {money(line.unitRate)}
                    </p>
                  </div>
                  <span className="shrink-0 text-body-sm font-medium tabular-nums text-foreground">
                    {money(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DefinitionList>
          <DefinitionRow label={t('detail.netPrice')} numeric>
            {money(variation.netPrice)}
          </DefinitionRow>
          <DefinitionRow label={t('detail.timeImpact')} numeric emptyText={t('detail.notSet')}>
            {variation.proposedTimeImpactDays === null
              ? undefined
              : t('detail.days', { n: variation.proposedTimeImpactDays })}
          </DefinitionRow>
          {variation.clientApprovedAt ? (
            <DefinitionRow label={t('detail.clientApproved')}>
              {formatDate(variation.clientApprovedAt, locale)}
            </DefinitionRow>
          ) : null}
          {variation.clientApprovalReference ? (
            <DefinitionRow label={t('detail.clientRef')}>
              {variation.clientApprovalReference}
            </DefinitionRow>
          ) : null}
          {variation.reason ? (
            <DefinitionRow label={t('detail.reason')}>{variation.reason}</DefinitionRow>
          ) : null}
        </DefinitionList>

        {/* Where this variation connects to the rest of the workspace: the contract value it moved
            when adopted, whether its scope has landed in the BOQ, and where it was billed — so the
            answer is here, not spread across three tabs. */}
        {showImpact ? (
          <section className="space-y-2.5 rounded-control border border-border bg-surface-subtle p-3">
            <h3 className="text-body-sm font-semibold text-foreground">{t('detail.impactTitle')}</h3>
            <DefinitionList>
              {isApproved ? (
                <DefinitionRow label={t('detail.contractImpact')}>
                  {isOmission
                    ? t('detail.contractImpactReduced', {
                        amount: money(Math.abs(Number(variation.netPrice))),
                      })
                    : t('detail.contractImpactRaised', { amount: money(variation.netPrice) })}
                </DefinitionRow>
              ) : null}
              <DefinitionRow label={t('detail.boqImpact')}>
                {variation.appliedToBoq
                  ? t('detail.boqApplied', { count: variation.boqNodeCount })
                  : isApproved
                    ? t('detail.boqNotApplied')
                    : t('detail.boqPending')}
              </DefinitionRow>
            </DefinitionList>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2.5">
              <span className="inline-flex items-center gap-2">
                <span className="text-caption text-muted-foreground">{t('detail.billing')}</span>
                <VariationBillingChip status={variation.status} billing={billing} />
              </span>
              {billing?.invoice ? (
                <Link
                  href={`/projects/${projectId}/commercial/billing-collection`}
                  className="inline-flex min-h-11 items-center gap-1 text-caption font-medium text-brand-primary hover:underline sm:min-h-0"
                >
                  {t('detail.viewBilling')}
                  <ArrowRight size={12} aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Reverse — the one operative command. Its inline confirm carries the warning and captures
            an optional reason; the server owns whether it is actually reversible. */}
        {confirming ? (
          <section className="space-y-3 rounded-control border border-warning/40 bg-warning-subtle p-3">
            <div className="flex items-start gap-2">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <div className="space-y-1">
                <h3 className="text-body-sm font-semibold text-foreground">
                  {t('detail.reverseTitle')}
                </h3>
                <p className="text-caption text-muted-foreground">{t('detail.reverseWarning')}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vo-reverse-reason">{t('detail.reverseReason')}</Label>
              <Textarea
                id="vo-reverse-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={2}
              />
            </div>
            {serverError ? (
              <p className="text-caption text-danger" role="alert">
                {serverError}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <DialogFooter>
        {confirming ? (
          <>
            <Button variant="destructive" onClick={runReverse} disabled={reverse.isPending}>
              {t('actions.confirmReverse')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(false);
                setServerError(null);
              }}
              disabled={reverse.isPending}
            >
              {tCommon('cancel')}
            </Button>
          </>
        ) : (
          <>
            {canOfferReverse ? (
              <Button variant="outline" onClick={() => setConfirming(true)}>
                {t('actions.reverse')}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onDone}>
              {t('actions.close')}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
