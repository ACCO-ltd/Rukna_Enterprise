'use client';

/**
 * Raise the order from an award (spec Q13, wireframe F). The common case is one confirm: the
 * draft order is prefilled — the awarded supplier, the request's items and quantities, prices
 * split pro rata from the estimate, the total locked at or under the award — with the winning
 * photo as evidence. "Adjust lines first" goes to the line editor; a request whose lines carry no
 * estimate (split mode MANUAL) goes there directly.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  Notice,
  Skeleton,
} from '@erp/ui';
import { ArrowRight } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PROCUREMENT_PERMISSIONS, QUOTATION_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, sumMinorUnits } from '@/lib/money';

import { useCancelPurchaseOrder } from '../../hooks/use-procurement';
import { useOrderDraft, useRaiseOrder, useRequestRedecision } from '../../hooks/use-quotations';
import { minorToMoney } from '../../quotations/order-rules';
import { actionEnabled, uomLabel } from '../../quotations/quote-rules';
import type { QuotationRequestDetail } from '../../quotations/types';
import { QuotePhotoImage, refusalCode, useRefusalText } from './quote-shared';

/** The awarded request's card on the buyer's screen. */
export function OrderCard({ detail }: { detail: QuotationRequestDetail }) {
  const t = useTranslations('procurement.quotes.order.card');
  const tPay = useTranslations('procurement.quotes.paymentPath');
  const router = useRouter();
  const { can } = usePermissions();
  const [confirming, setConfirming] = useState(false);
  const award = detail.award;
  const winner = award ? (detail.quotes.find((q) => q.id === award.quoteId) ?? null) : null;
  const mayRaise =
    can(QUOTATION_PERMISSIONS.collect) &&
    can(PROCUREMENT_PERMISSIONS.createOrder) &&
    actionEnabled(detail.allowedActions, 'RAISE_ORDER', !detail.purchaseOrder);
  const liveOrder = detail.purchaseOrder && detail.purchaseOrder.status !== 'CANCELLED' ? detail.purchaseOrder : null;
  // Prefetched, so the tap already knows whether the split needs typing (MANUAL → line editor).
  const draft = useOrderDraft(detail.id, { enabled: Boolean(award) && mayRaise && !liveOrder });
  if (!award) return null;
  const store = award.supplier?.name ?? winner?.store.name ?? '—';
  const adjustHref = `/procurement/quotes/${detail.id}/order`;

  return (
    <section className="space-y-3 rounded-panel border border-success/40 bg-success-subtle p-4">
      <div>
        <h2 className="text-body font-semibold text-foreground">{t('title', { store })}</h2>
        {award.total !== null ? (
          <p className="text-h3 font-semibold tabular-nums text-foreground">
            {formatMoney(award.total, detail.currencyCode ?? 'USD')}
          </p>
        ) : null}
        {award.paymentPath ? (
          <p className="text-body-sm text-muted-foreground">{t('payBy', { payBy: tPay(award.paymentPath) })}</p>
        ) : null}
      </div>
      {liveOrder ? (
        <Button asChild size="lg" className="w-full">
          <Link href={`/procurement/orders/${liveOrder.id}`}>
            {t('openOrder')} · {liveOrder.poNumber}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : mayRaise ? (
        <div className="space-y-1 text-center">
          <Button
            type="button"
            size="lg"
            className="h-14 w-full text-base"
            onClick={() => {
              if (draft.data?.splitMode === 'MANUAL') router.push(adjustHref);
              else setConfirming(true);
            }}
          >
            {t('raise')}
          </Button>
          <Button type="button" variant="link" className="min-h-11" onClick={() => router.push(adjustHref)}>
            {t('adjust')}
          </Button>
        </div>
      ) : (
        <p className="text-body-sm text-muted-foreground">{t('noPermission')}</p>
      )}
      {confirming ? <RaiseOrderDialog detail={detail} onClose={() => setConfirming(false)} /> : null}
    </section>
  );
}

/** One confirm: the prefilled draft order, then Create draft order. */
function RaiseOrderDialog({ detail, onClose }: { detail: QuotationRequestDetail; onClose: () => void }) {
  const t = useTranslations('procurement.quotes.order.confirm');
  const tCapture = useTranslations('procurement.quotes.capture');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const draft = useOrderDraft(detail.id);
  const raise = useRaiseOrder(detail.id, detail.materialRequest.id);
  const refusal = useRefusalText();
  const currency = detail.currencyCode ?? 'USD';
  const money = (value: string | null | undefined) => formatMoney(value ?? null, currency) ?? '—';
  const winner = detail.quotes.find((q) => q.id === detail.award?.quoteId) ?? null;
  const photo = winner?.photos[0] ?? null;

  const exceeds = refusalCode(raise.error) === 'PO_EXCEEDS_AWARD';
  const lines = draft.data?.lines ?? [];
  const priced = lines.length > 0 && lines.every((line) => line.amount != null);
  const total = priced ? minorToMoney(sumMinorUnits(lines.map((line) => line.amount), MONEY_SCALE)) : null;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title={t('title')}
      subtitle={t('subtitle', { store: draft.data?.supplier?.name ?? detail.award?.supplier?.name ?? '—' })}
      busy={raise.isPending}
      closeLabel={tCommon('close')}
      initialFocus="dialog"
      onSubmit={(event) => {
        event.preventDefault();
        raise.mutate({}, { onSuccess: (result) => router.push(`/procurement/orders/${result.purchaseOrderId}`) });
      }}
    >
      <FormDialogBody className="space-y-4">
        {raise.error && !exceeds ? <Alert variant="error" messages={[refusal(raise.error) ?? '']} /> : null}
        {exceeds ? <ExceedsAward requestId={detail.id} adjustHref={`/procurement/quotes/${detail.id}/order`} /> : null}
        {draft.isPending ? (
          <div role="status" className="space-y-2">
            <span className="sr-only">{t('loading')}</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : draft.isError || !draft.data ? (
          <Alert variant="error" messages={[refusal(draft.error) ?? '']} />
        ) : (
          <>
            <div className="flex gap-3">
              {photo ? (
                <div className="w-24 shrink-0 overflow-hidden rounded-control border border-border">
                  <QuotePhotoImage
                    fileId={photo.fileId}
                    alt={tCapture('photoAlt', { store: winner?.store.name ?? '', page: 1 })}
                    className="aspect-[3/4] w-full"
                  />
                </div>
              ) : null}
              <dl className="min-w-0 space-y-2 text-body-sm">
                <div>
                  <dt className="text-caption text-muted-foreground">{t('supplier')}</dt>
                  <dd className="font-semibold text-foreground">{draft.data.supplier?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">{t('evidence')}</dt>
                  <dd className="text-foreground">{detail.number}</dd>
                </div>
              </dl>
            </div>
            <ul className="divide-y divide-border rounded-panel border border-border">
              {draft.data.lines.map((line) => (
                <li key={line.materialRequestLineId} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 text-body-sm text-foreground">
                    {line.description}
                    <span className="ms-2 tabular-nums text-muted-foreground">
                      {formatNumber(line.quantity)} {uomLabel(line.uom)}
                    </span>
                  </span>
                  {line.amount != null ? (
                    <span className="tabular-nums text-body-sm font-medium text-foreground">{money(line.amount)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {total !== null && draft.data.awardedTotal ? (
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm">
                <span className="text-muted-foreground">{t('total')}</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {money(total)}{' '}
                  <span className="font-normal text-muted-foreground">
                    {t('ofAward', { award: money(draft.data.awardedTotal) })}
                  </span>
                </span>
              </p>
            ) : null}
          </>
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" className="min-h-11" loading={raise.isPending} disabled={!draft.data || exceeds}>
          {t('create')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}

/**
 * 422 (raise-order) / 409 (PO confirm) `PO_EXCEEDS_AWARD`: lower the amounts, or send it back to
 * finance to choose again. The server refuses a re-decision while a draft order from the award is
 * live (`PURCHASE_ORDER_LIVE`), so when there is one it is cancelled first, then re-decision runs.
 */
export function ExceedsAward({
  requestId,
  draftPurchaseOrderId,
  adjustHref,
}: {
  requestId: string;
  /** Where to adjust the lines (the raise dialog); omitted on the line editor itself. */
  adjustHref?: string;
  /** The live draft PO raised from this award, when the refusal came from confirming it. */
  draftPurchaseOrderId?: string | null;
}) {
  const t = useTranslations('procurement.quotes.order.exceeds');
  const router = useRouter();
  const redecide = useRequestRedecision(requestId);
  const cancelPo = useCancelPurchaseOrder();
  const refusal = useRefusalText();
  const [open, setOpen] = useState(false);
  const [poCancelled, setPoCancelled] = useState(false);
  const busy = cancelPo.isPending || redecide.isPending;

  const sendBack = async (reason: string) => {
    try {
      if (draftPurchaseOrderId && !poCancelled) {
        await cancelPo.mutateAsync(draftPurchaseOrderId);
        setPoCancelled(true);
      }
      await redecide.mutateAsync(reason);
      setOpen(false);
      router.push(`/procurement/quotes/${requestId}`);
    } catch {
      // The dialog shows the refusal; a retry skips the cancel if it already went through.
    }
  };

  return (
    <Notice
      tone="danger"
      title={t('title')}
      action={
        <div className="flex flex-wrap gap-2">
          {adjustHref ? (
            <Button type="button" className="min-h-11" onClick={() => router.push(adjustHref)}>
              {t('adjust')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)}>
            {t('sendBack')}
          </Button>
        </div>
      }
    >
      <p className="mt-1">{draftPurchaseOrderId ? t('bodyDraft') : t('body')}</p>
      {open ? (
        <ConfirmActionDialog
          title={t('sendBackTitle')}
          description={draftPurchaseOrderId ? t('sendBackBodyCancelsDraft') : t('sendBackBody')}
          confirmLabel={t('sendBack')}
          reason={{ label: t('sendBackReason'), required: true }}
          isPending={busy}
          errorMessage={refusal(cancelPo.error ?? redecide.error)}
          onConfirm={(text) => void sendBack(text)}
          onDismiss={() => {
            cancelPo.reset();
            redecide.reset();
            setOpen(false);
          }}
        />
      ) : null}
    </Notice>
  );
}
