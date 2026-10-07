'use client';

/**
 * `/procurement/quotes/[id]/order` — adjust the lines before the draft order exists (ADR-044 §8:
 * there is no draft-line edit endpoint, so adjustment happens here). Quantities up to what the
 * request still needs, amounts within the award; a meter shows the total against the award and
 * Create draft order stays disabled while it is over.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, MoneyInput, Notice, Progress, QuantityInput, Skeleton, Switch, cn } from '@erp/ui';
import { ChevronLeft } from 'lucide-react';

import { useModuleTrail } from '@/components/layout/module-chrome';
import { formatMoney, formatNumber } from '@/lib/format';

import { useOrderDraft, useQuotationRequest, useRaiseOrder } from '../../hooks/use-quotations';
import {
  checkOrderLines,
  initialOrderLines,
  minorToMoney,
  trimQuantity,
  type EditableOrderLine,
} from '../../quotations/order-rules';
import { uomLabel } from '../../quotations/quote-rules';
import type { OrderDraft, QuotationRequestDetail } from '../../quotations/types';
import { ExceedsAward } from './order-raise';
import { refusalCode, useRefusalText } from './quote-shared';

export function OrderAdjustScreen({ id }: { id: string }) {
  const tq = useTranslations('procurement.quotes');
  const detail = useQuotationRequest(id);
  const draft = useOrderDraft(id);
  useModuleTrail(detail.data?.number);

  if (detail.isPending || draft.isPending) {
    return (
      <div role="status" className="mx-auto w-full max-w-2xl space-y-3">
        <span className="sr-only">{tq('order.confirm.loading')}</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (detail.isError || draft.isError || !detail.data || !draft.data) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <Alert variant="error" messages={[tq('loadFailed')]} />
        <Button variant="outline" className="min-h-11" onClick={() => void Promise.all([detail.refetch(), draft.refetch()])}>
          {tq('retry')}
        </Button>
      </div>
    );
  }
  return <AdjustBody detail={detail.data} draft={draft.data} />;
}

function AdjustBody({ detail, draft }: { detail: QuotationRequestDetail; draft: OrderDraft }) {
  const t = useTranslations('procurement.quotes.order.adjust');
  const router = useRouter();
  const refusal = useRefusalText();
  const raise = useRaiseOrder(detail.id, detail.materialRequest.id);
  const [lines, setLines] = useState<EditableOrderLine[]>(() => initialOrderLines(draft.lines));
  const award = draft.awardedTotal ?? detail.award?.total ?? null;
  const currency = detail.currencyCode ?? 'USD';
  const money = (value: string | null) => formatMoney(value, currency) ?? '—';
  const check = checkOrderLines(lines, draft.lines, award);
  const exceeds = refusalCode(raise.error) === 'PO_EXCEEDS_AWARD';

  const update = (lineId: string, patch: Partial<EditableOrderLine>) =>
    setLines((all) => all.map((line) => (line.materialRequestLineId === lineId ? { ...line, ...patch } : line)));

  const submit = () => {
    if (!check.ok) return;
    raise.mutate(
      {
        lines: lines
          .filter((line) => line.included)
          .map((line) => ({ materialRequestLineId: line.materialRequestLineId, quantity: line.quantity, amount: line.amount })),
      },
      { onSuccess: (result) => router.push(`/procurement/orders/${result.purchaseOrderId}`) },
    );
  };

  const percent = check.awardMinor ? Math.min(100, (check.totalMinor / check.awardMinor) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-8">
      <Link
        href={`/procurement/quotes/${detail.id}`}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('back')}
      </Link>
      <div>
        <h1 className="text-h2 font-semibold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {draft.splitMode === 'MANUAL' ? <Notice tone="info">{t('manual')}</Notice> : null}
      {exceeds ? <ExceedsAward requestId={detail.id} /> : null}
      {raise.error && !exceeds ? <Alert variant="error" messages={[refusal(raise.error) ?? '']} /> : null}

      <ul className="space-y-3">
        {draft.lines.map((source) => {
          const line = lines.find((l) => l.materialRequestLineId === source.materialRequestLineId)!;
          const qtyProblem = check.quantityProblems.has(source.materialRequestLineId);
          const unit = uomLabel(source.uom);
          return (
            <li
              key={source.materialRequestLineId}
              className={cn(
                'space-y-3 rounded-panel border border-border bg-surface p-3 shadow-e1',
                !line.included && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium text-foreground">{source.description}</p>
                <Switch
                  checked={line.included}
                  onCheckedChange={(included: boolean) => update(source.materialRequestLineId, { included })}
                  aria-label={`${t('include')}: ${source.description}`}
                  // A 24px switch with a 48px hit area (doctrine: 44px targets at 375px).
                  className="mt-1 before:absolute before:-inset-3 before:content-['']"
                />
              </div>
              {line.included ? (
                <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                  <div>
                    <QuantityInput
                      aria-label={t('quantity', { item: source.description })}
                      value={line.quantity}
                      maxFractionDigits={4}
                      unit={unit}
                      aria-invalid={qtyProblem || undefined}
                      onValueChange={(quantity) => update(source.materialRequestLineId, { quantity })}
                    />
                    <p className={cn('mt-1 text-caption', qtyProblem ? 'text-danger' : 'text-muted-foreground')}>
                      {qtyProblem
                        ? t('quantityOver')
                        : t('max', { max: `${formatNumber(trimQuantity(source.maxQuantity))} ${unit}`.trim() })}
                    </p>
                  </div>
                  <MoneyInput
                    aria-label={t('amount', { item: source.description })}
                    value={line.amount}
                    onValueChange={(amount) => update(source.materialRequestLineId, { amount })}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0">
        <Progress
          value={percent}
          tone={check.overMinor > 0 ? 'danger' : percent >= 100 ? 'success' : 'default'}
          label={t('meter', { total: money(minorToMoney(check.totalMinor)), award: money(award) })}
        />
        <p aria-live="polite" className="flex flex-wrap justify-between gap-2 text-body-sm">
          <span className="tabular-nums text-foreground">
            {t('meter', { total: money(minorToMoney(check.totalMinor)), award: money(award) })}
          </span>
          {check.overMinor > 0 ? (
            <span className="font-semibold text-danger">{t('overCap', { over: money(minorToMoney(check.overMinor)) })}</span>
          ) : null}
          {check.noLines ? <span className="text-danger">{t('noLines')}</span> : null}
        </p>
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={!check.ok}
          loading={raise.isPending}
          onClick={submit}
        >
          {t('create')}
        </Button>
      </div>
    </div>
  );
}
