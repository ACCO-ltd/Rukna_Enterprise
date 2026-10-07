'use client';

/**
 * ─── Decision screen — `/finance/quotes/[id]` (ADR-044, spec Q12, wireframe E) ─────────
 *
 * The notification deep link opens this screen itself. Finance should decide in under a minute:
 * look at each photo (big; tap to zoom), type its total (Enter moves to the next), see the lowest
 * highlighted live, tap Choose, pick how it is paid. Phone: one quote per screen, swipe between
 * them. Desktop (≥ 1024 px): the quotes side by side.
 *
 * Totals autosave on blur. Choose stays hidden until every quote has a total (the reason is
 * written instead). Segregation of duties is the server's call: a barred viewer sees the photos
 * read-only with the server's reason, and any refusal is said in plain words.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  ChoiceCards,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  MoneyInput,
  Notice,
  Skeleton,
  Textarea,
  cn,
} from '@erp/ui';
import { Check, ChevronLeft, ChevronRight, Expand, TriangleAlert } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { QUOTATION_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';
import { WorkflowTransactionType } from '@/features/workflows/types';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import {
  useAskForAnotherQuote,
  useAwardQuotation,
  useEnterQuoteTotal,
  useQuotationRequest,
  useRejectQuote,
  useWithdrawAward,
} from '../../hooks/use-quotations';
import {
  WAITING_STATUSES,
  actionEnabled,
  activeQuotes,
  allTotalsEntered,
  findAction,
  lowestQuoteIds,
  photoCountOf,
  selectionBarCode,
  totalMinor,
} from '../../quotations/quote-rules';
import type {
  AwardPayload,
  Quote,
  QuotationRequestDetail,
  QuoteRejectReason,
} from '../../quotations/types';
import { ChooseDialog } from './choose-dialog';
import { PhotoViewer } from './photo-viewer';
import {
  PhotosHidden,
  QuotationStatusPill,
  QuotePhotoImage,
  WaitingTime,
  refusalCode,
  useRefusalText,
} from './quote-shared';

/** The award's governed transition (ADR-044 §7). */
const QUOTATION_AWARD = WorkflowTransactionType.QUOTATION_AWARD;
const REJECT_REASONS: QuoteRejectReason[] = ['ILLEGIBLE', 'WRONG_ITEMS', 'INCOMPLETE', 'OTHER'];

type SaveState = 'saving' | 'saved' | 'failed';

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function QuoteDecisionScreen({ id }: { id: string }) {
  const tq = useTranslations('procurement.quotes');
  const detail = useQuotationRequest(id, {
    poll: (data) => (data ? WAITING_STATUSES.has(data.status) : true),
  });
  useModuleTrail(detail.data?.number);

  if (detail.isPending) {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">{tq('decision.photoLoading')}</span>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-4">
        <Alert
          variant="error"
          messages={[
            detail.error instanceof ApiError &&
            (detail.error.status === 403 || detail.error.status === 404)
              ? tq('noAccess')
              : tq('loadFailed'),
          ]}
        />
        <Button variant="outline" className="min-h-11" onClick={() => void detail.refetch()}>
          {tq('retry')}
        </Button>
      </div>
    );
  }
  return <DecisionBody detail={detail.data} />;
}

function DecisionBody({ detail }: { detail: QuotationRequestDetail }) {
  const t = useTranslations('procurement.quotes.decision');
  const tRefusal = useTranslations('procurement.quotes.refusal');
  const tPay = useTranslations('procurement.quotes.paymentPath');
  const tCapture = useTranslations('procurement.quotes.capture');
  const tException = useTranslations('procurement.quotes.exceptionReason');
  const refusal = useRefusalText();
  const { can } = usePermissions();
  const session = useSession();
  const currency = detail.currencyCode ?? 'USD';
  const money = (value: string | null | undefined) => formatMoney(value ?? null, currency) ?? '—';

  const quotes = activeQuotes(detail.quotes);
  const rejected = detail.quotes.filter((q) => q.status === 'REJECTED');
  const deciding = detail.status === 'AWAITING_DECISION';
  const mayAward = can(QUOTATION_PERMISSIONS.award);
  const barCode = selectionBarCode(detail);
  const canEnter =
    deciding && mayAward && !barCode && actionEnabled(detail.allowedActions, 'ENTER_TOTAL', true);

  // ── Totals: local drafts over the server's values; autosave on blur ─────────────
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const enterTotal = useEnterQuoteTotal(detail.id);
  const valueOf = (quote: Quote) => drafts[quote.id] ?? quote.enteredTotal ?? '';
  const values = quotes.map((quote) => ({ id: quote.id, total: valueOf(quote) }));
  const lowest = lowestQuoteIds(values);
  const allEntered = allTotalsEntered(values);
  const lowestValue = values.find((v) => lowest.has(v.id))?.total ?? null;

  const dirtyIds = () =>
    quotes
      .filter((q) => drafts[q.id] !== undefined && totalMinor(drafts[q.id]) !== null)
      .filter((q) => totalMinor(drafts[q.id]) !== totalMinor(q.enteredTotal))
      .map((q) => q.id);

  const save = (quoteId: string): Promise<void> => {
    const draft = drafts[quoteId];
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote || draft === undefined || totalMinor(draft) === null) return Promise.resolve();
    if (totalMinor(draft) === totalMinor(quote.enteredTotal)) return Promise.resolve();
    setSaveState((s) => ({ ...s, [quoteId]: 'saving' }));
    return enterTotal.mutateAsync({ quoteId, total: draft }).then(
      () => {
        setSaveState((s) => ({ ...s, [quoteId]: 'saved' }));
        setDrafts((d) => without(d, quoteId));
        setSaveError(null);
      },
      (error: unknown) => {
        setSaveState((s) => ({ ...s, [quoteId]: 'failed' }));
        setSaveError(error);
        throw error;
      },
    );
  };

  // ── Phone strip: one quote per screen ──────────────────────────────────────────
  const stripRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const chooseRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusChoosePending = useRef(false);
  const [current, setCurrent] = useState(0);
  const showCard = (index: number) => {
    const card = cardRefs.current[index];
    if (card) card.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    setCurrent(index);
  };

  // ── Dialogs ────────────────────────────────────────────────────────────────────
  const [choosing, setChoosing] = useState<Quote | null>(null);
  const [rejecting, setRejecting] = useState<Quote | null>(null);
  const [asking, setAsking] = useState(false);
  const [viewing, setViewing] = useState<{ quote: Quote; page: number } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [gatedInstance, setGatedInstance] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const award = useAwardQuotation(detail.id);
  const reject = useRejectQuote(detail.id);
  const ask = useAskForAnotherQuote(detail.id);
  const withdraw = useWithdrawAward(detail.id);

  // The server says QUOTE_TOTALS_MISSING until the typed totals have saved; they are flushed before
  // the award, so locally complete totals are enough to offer Choose.
  const awardVerdict = findAction(detail.allowedActions, 'AWARD');
  const awardOpen =
    !awardVerdict || awardVerdict.enabled || awardVerdict.reasonCode === 'QUOTE_TOTALS_MISSING';
  const chooseEnabled = deciding && mayAward && !barCode && allEntered && awardOpen;
  const mayAsk =
    deciding && mayAward && !barCode && actionEnabled(detail.allowedActions, 'ASK_ANOTHER', true);
  const mayReject =
    deciding && mayAward && !barCode && actionEnabled(detail.allowedActions, 'REJECT_QUOTE', true);

  const runAward = async (payload: AwardPayload) => {
    try {
      await Promise.all(dirtyIds().map((quoteId) => save(quoteId)));
    } catch {
      return; // the card shows "Not saved"; the dialog shows the refusal
    }
    award.mutate(payload, {
      onSuccess: () => setChoosing(null),
      onError: (error) => {
        // 409 AWARD_PENDING_APPROVAL (+ approvalInstanceId) is the DoA gate, not a failure (ADR-015).
        const instance =
          error instanceof ApiError &&
          error.status === 409 &&
          (error.details?.code === 'AWARD_PENDING_APPROVAL' || error.details?.approvalInstanceId)
            ? ((error.details?.approvalInstanceId as string | undefined) ?? null)
            : null;
        if (instance) {
          setGatedInstance(instance);
          setChoosing(null);
          award.reset();
        } else if (refusalCode(error) === 'QUOTATION_CHANGED') {
          // The request was reloaded (the hook refetches on any refusal): review it afresh.
          setChoosing(null);
          setChanged(true);
          award.reset();
        }
      },
    });
  };

  const awardedQuote = detail.award
    ? detail.quotes.find((q) => q.id === detail.award?.quoteId)
    : null;
  const proposedQuote = detail.proposal
    ? detail.quotes.find((q) => q.id === detail.proposal?.quoteId)
    : null;
  const pendingInstance =
    detail.approval?.instanceId ?? detail.award?.approvalInstanceId ?? gatedInstance;
  const short = detail.distinctSupplierCount < detail.requiredQuoteCount;
  // After the last total's Enter, focus moves to the lowest quote's Choose as soon as it renders.
  const focusLowestChoose = () => {
    if (!focusChoosePending.current) return;
    const index = quotes.findIndex((quote) => lowest.has(quote.id));
    const button = index >= 0 ? chooseRefs.current[index] : null;
    // Kept pending (not cleared on success): the totals' save re-renders the cards, and focus is
    // put back if a re-render took it. Cleared when the user moves on (a total, a dialog).
    if (button && document.activeElement !== button) {
      button.focus();
      showCard(index);
    }
  };
  useEffect(focusLowestChoose);
  // Any key or pointer press after that is the user moving on: stop putting focus back.
  useEffect(() => {
    const stop = () => {
      focusChoosePending.current = false;
    };
    window.addEventListener('pointerdown', stop);
    window.addEventListener('keydown', stop);
    return () => {
      window.removeEventListener('pointerdown', stop);
      window.removeEventListener('keydown', stop);
    };
  }, []);
  // An unregistered store with no matching supplier can only be awarded by someone who may
  // register it (manage:payable); say so on the card, before Choose. The server still decides.
  const mayRegister = can('manage:payable');
  const needsRegistrar = (quote: Quote) =>
    !mayRegister &&
    !quote.store.registered &&
    !detail.supplierMatches.some((m) => m.quoteId === quote.id && m.suppliers.length > 0);
  // Every step approved: only the re-drive is left ("Approved — complete the choice").
  const chainApproved = detail.approval?.status === 'APPROVED';
  const roles = session.user?.roles ?? [];
  const currentRole = detail.approval?.currentStepRole ?? null;
  const mayActOnStep =
    can('manage:workflow') ||
    (currentRole !== null && roles.includes(currentRole)) ||
    (!detail.approval && Boolean(gatedInstance));

  return (
    <div className="space-y-4 pb-8">
      <Link
        href="/finance/quotes"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('back')}
      </Link>

      {/* ── Context strip ─────────────────────────────────────────────────── */}
      <header className="rounded-panel border border-border bg-surface p-4 shadow-e1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 text-body font-semibold text-foreground">
            {t('header', { number: detail.number, mrNumber: detail.materialRequest.number })}
            {detail.materialRequest.title ? (
              <span className="block truncate text-body-sm font-normal text-muted-foreground">
                {detail.materialRequest.title}
              </span>
            ) : null}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {detail.urgent ? <Badge tone="attention">{t('context.urgent')}</Badge> : null}
            <QuotationStatusPill status={detail.status} />
          </div>
        </div>
        <ContextStrip detail={detail} money={money} />
      </header>

      {/* ── State notices ─────────────────────────────────────────────────── */}
      {!mayAward ? <Notice tone="info">{t('readOnlyCollector')}</Notice> : null}
      {barCode && deciding ? (
        <Notice tone="attention" title={t('barredTitle')}>
          <p className="mt-1">{tRefusal.has(barCode) ? tRefusal(barCode) : barCode}</p>
        </Notice>
      ) : null}
      {short && deciding && detail.exceptionReason ? (
        <Notice tone="attention">
          {t('exceptionShort', {
            count: detail.distinctSupplierCount,
            required: detail.requiredQuoteCount,
            reason: tException(detail.exceptionReason),
          })}
        </Notice>
      ) : null}
      {detail.status === 'COLLECTING' ||
      detail.status === 'RETURNED' ||
      detail.status === 'CANCELLED' ? (
        <Notice tone={detail.status === 'CANCELLED' ? 'historical' : 'info'}>
          {t(`notReady.${detail.status}`)}
        </Notice>
      ) : null}
      {detail.status === 'AWARDED' && detail.award ? (
        <Notice
          tone="success"
          title={t('awarded.title', {
            store: awardedQuote?.store.name ?? detail.award.supplier?.name ?? '—',
          })}
        >
          <p className="mt-1">
            {detail.award.total !== null
              ? t('awarded.body', {
                  total: money(detail.award.total),
                  payBy: detail.award.paymentPath ? tPay(detail.award.paymentPath) : '—',
                })
              : t('awarded.bodyNoMoney', {
                  payBy: detail.award.paymentPath ? tPay(detail.award.paymentPath) : '—',
                })}
          </p>
          {detail.purchaseOrder ? (
            <p className="mt-1">
              {t('awarded.order')}: {detail.purchaseOrder.poNumber}
            </p>
          ) : null}
        </Notice>
      ) : null}
      {detail.status === 'AWARD_PENDING_APPROVAL' || gatedInstance ? (
        <section className="space-y-3">
          <Notice
            tone={chainApproved ? 'success' : 'info'}
            title={chainApproved ? t('pending.approvedTitle') : t('pending.title')}
          >
            <p className="mt-1">
              {t(chainApproved ? 'pending.approvedBody' : 'pending.body', {
                store: proposedQuote?.store.name ?? '—',
                total: money(proposedQuote?.enteredTotal),
              })}
            </p>
          </Notice>
          {/* The chain comes from the quotation's own read model, so everyone sees it; the
              approve/reject panel (workflow reads) only for those who can act on it. */}
          {detail.approval?.steps.length ? <ApprovalSteps approval={detail.approval} /> : null}
          {!chainApproved && mayActOnStep ? (
            <ApprovalPanel instanceId={pendingInstance} transactionType={QUOTATION_AWARD} />
          ) : null}
          {mayAward ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={chainApproved ? 'default' : 'outline'}
                className="min-h-11"
                loading={award.isPending}
                onClick={() => award.mutate({}, { onError: () => undefined })}
              >
                {t('pending.redrive')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setWithdrawing(true)}
              >
                {t('pending.withdraw')}
              </Button>
            </div>
          ) : null}
          {award.error && !choosing ? (
            <Alert variant="error" messages={[refusal(award.error) ?? '']} />
          ) : null}
        </section>
      ) : null}

      {changed ? (
        <Notice tone="attention">{tRefusal('QUOTATION_CHANGED')}</Notice>
      ) : null}
      {saveError ? <Alert variant="error" messages={[refusal(saveError) ?? '']} /> : null}

      {/* ── Quotes: swipe on a phone, side by side from 1024 px ────────────── */}
      <section aria-label={t('quotesLabel')}>
        {quotes.length > 1 ? (
          <div className="mb-2 flex items-center justify-between gap-2 lg:hidden">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 min-h-11 w-11 min-w-11"
              aria-label={t('previous')}
              disabled={current === 0}
              onClick={() => showCard(current - 1)}
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Button>
            <div className="flex items-center gap-1">
              {quotes.map((quote, index) => (
                <button
                  key={quote.id}
                  type="button"
                  aria-label={t('pageDots', { index: index + 1 })}
                  aria-current={index === current ? 'true' : undefined}
                  className="flex size-11 items-center justify-center"
                  onClick={() => showCard(index)}
                >
                  <span
                    className={cn(
                      'size-2.5 rounded-full',
                      index === current ? 'bg-brand-primary' : 'bg-border-strong',
                    )}
                  />
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 min-h-11 w-11 min-w-11"
              aria-label={t('next')}
              disabled={current >= quotes.length - 1}
              onClick={() => showCard(current + 1)}
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <div
          ref={stripRef}
          className={cn(
            'flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2',
            'lg:grid lg:snap-none lg:overflow-visible',
            quotes.length >= 3
              ? 'lg:grid-cols-3'
              : quotes.length === 2
                ? 'lg:grid-cols-2'
                : 'lg:grid-cols-1',
          )}
          onScroll={(event) => {
            const el = event.currentTarget;
            if (el.clientWidth > 0) setCurrent(Math.round(el.scrollLeft / el.clientWidth));
          }}
        >
          {quotes.map((quote, index) => {
            const value = valueOf(quote);
            // Only once every total is in: a "lowest" among two of three totals would mislead.
            const isLowest = allEntered && lowest.has(quote.id);
            return (
              <article
                key={quote.id}
                ref={(el) => {
                  cardRefs.current[index] = el;
                }}
                aria-label={t('quoteOf', { index: index + 1, count: quotes.length })}
                className={cn(
                  'w-full shrink-0 snap-center rounded-panel border bg-surface p-3 shadow-e1 lg:w-auto',
                  isLowest && detail.moneyVisible
                    ? 'border-success ring-1 ring-success/40'
                    : 'border-border',
                  detail.award?.quoteId === quote.id && 'border-success',
                )}
              >
                <QuotePhotos quote={quote} onOpen={(page) => setViewing({ quote, page })} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold text-foreground">
                    {quote.store.name}
                    {!quote.store.registered ? (
                      <span className="ms-1.5 text-caption font-normal text-muted-foreground">
                        ({tCapture('newStore')})
                      </span>
                    ) : null}
                  </p>
                  {isLowest && detail.moneyVisible ? (
                    <Badge tone="success">{t('lowest')}</Badge>
                  ) : null}
                </div>
                <PhotoMeta quote={quote} />

                {detail.moneyVisible ? (
                  <div className="mt-3">
                    <FormField
                      htmlFor={`quote-total-${quote.id}`}
                      label={t('total')}
                      hint={t('totalHint')}
                    >
                      <MoneyInput
                        id={`quote-total-${quote.id}`}
                        ref={(el) => {
                          inputRefs.current[index] = el;
                        }}
                        aria-label={t('totalFor', { store: quote.store.name })}
                        value={value}
                        readOnly={!canEnter}
                        enterKeyHint={index < quotes.length - 1 ? 'next' : 'done'}
                        className="h-12 text-lg"
                        onValueChange={(raw) => {
                          setDrafts((d) => ({ ...d, [quote.id]: raw }));
                          setSaveState((st) => without(st, quote.id));
                        }}
                        onFocus={() => {
                          focusChoosePending.current = false;
                          setCurrent(index);
                        }}
                        onBlur={() => {
                          void save(quote.id).catch(() => undefined);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          const next = inputRefs.current[index + 1];
                          if (next) {
                            next.focus();
                            showCard(index + 1);
                          } else {
                            // Last total: hand focus to the lowest quote's Choose once it shows.
                            // Blur first — focusing during the blur would be undone by it.
                            event.currentTarget.blur();
                            // After this Enter has finished bubbling (it would count as "moving on").
                            setTimeout(() => {
                              focusChoosePending.current = true;
                              focusLowestChoose();
                            }, 0);
                          }
                        }}
                      />
                    </FormField>
                    <SaveIndicator state={saveState[quote.id]} />
                  </div>
                ) : null}

                {deciding && mayAward && !barCode ? (
                  <div className="mt-3 space-y-2">
                    {needsRegistrar(quote) ? (
                      <p className="rounded-control bg-warning-subtle px-3 py-2 text-center text-caption text-foreground">
                        {t('chooseDialog.registerNeedsPayables')}
                      </p>
                    ) : chooseEnabled ? (
                      <Button
                        ref={(el) => {
                          chooseRefs.current[index] = el;
                        }}
                        type="button"
                        size="lg"
                        className="w-full"
                        variant={isLowest ? 'default' : 'outline'}
                        onClick={() => {
                          focusChoosePending.current = false;
                          setChoosing(quote);
                        }}
                      >
                        {t('chooseStore', { store: quote.store.name })}
                      </Button>
                    ) : (
                      <p className="rounded-control bg-surface-subtle px-3 py-2 text-center text-caption text-muted-foreground">
                        {t('chooseBlocked')}
                      </p>
                    )}
                    {mayReject ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 w-full text-muted-foreground"
                        onClick={() => setRejecting(quote)}
                      >
                        {t('reject')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {rejected.length > 0 ? <RejectedList quotes={rejected} /> : null}

      {mayAsk ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          onClick={() => setAsking(true)}
        >
          {t('askAnother')}
        </Button>
      ) : null}

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      {choosing ? (
        <ChooseDialog
          detail={detail}
          quote={choosing}
          totalText={money(valueOf(choosing))}
          lowestText={lowestValue ? money(lowestValue) : null}
          isLowest={lowest.has(choosing.id)}
          canRegisterSupplier={mayRegister}
          busy={award.isPending || enterTotal.isPending}
          error={award.error ? (refusal(award.error) ?? null) : null}
          onChoose={(payload) => void runAward(payload)}
          onClose={() => {
            award.reset();
            setChoosing(null);
          }}
        />
      ) : null}
      {rejecting ? (
        <RejectDialog
          quote={rejecting}
          busy={reject.isPending}
          error={reject.error ? (refusal(reject.error) ?? null) : null}
          onReject={(reason, note) =>
            reject.mutate(
              { quoteId: rejecting.id, reason, note },
              { onSuccess: () => setRejecting(null) },
            )
          }
          onClose={() => {
            reject.reset();
            setRejecting(null);
          }}
        />
      ) : null}
      {asking ? (
        <AskAnotherDialog
          busy={ask.isPending}
          error={ask.error ? (refusal(ask.error) ?? null) : null}
          onSend={(note) => ask.mutate(note, { onSuccess: () => setAsking(false) })}
          onClose={() => {
            ask.reset();
            setAsking(false);
          }}
        />
      ) : null}
      {viewing ? (
        <PhotoViewer
          store={viewing.quote.store.name}
          photos={viewing.quote.photos}
          initialPage={viewing.page}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {withdrawing ? (
        <ConfirmActionDialog
          title={t('pending.withdrawTitle')}
          description={t('pending.withdrawBody')}
          confirmLabel={t('pending.withdraw')}
          isPending={withdraw.isPending}
          errorMessage={refusal(withdraw.error)}
          onConfirm={() =>
            withdraw.mutate(undefined, {
              onSuccess: () => {
                setWithdrawing(false);
                setGatedInstance(null);
              },
            })
          }
          onDismiss={() => {
            withdraw.reset();
            setWithdrawing(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────────

/** The award's chain from the read model: each step, who approved it, which one is current. */
function ApprovalSteps({
  approval,
}: {
  approval: NonNullable<QuotationRequestDetail['approval']>;
}) {
  const t = useTranslations('procurement.quotes.decision.pending');
  return (
    <ol
      className="space-y-1 rounded-panel border border-border bg-surface p-3 text-body-sm"
      aria-label={t('chain')}
    >
      {[...approval.steps]
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map((step) => {
          const current = step.stepOrder === approval.currentStepOrder && !step.approvedBy;
          return (
            <li key={step.stepOrder} className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={cn('font-medium', current ? 'text-foreground' : 'text-muted-foreground')}
              >
                {step.stepOrder}. {step.roleRequired}
              </span>
              <span
                className={cn(
                  'text-caption',
                  step.approvedBy ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {step.approvedBy
                  ? t('stepApproved', { name: step.approvedBy.name })
                  : current
                    ? t('stepCurrent')
                    : t('stepWaiting')}
              </span>
            </li>
          );
        })}
    </ol>
  );
}

function ContextStrip({
  detail,
  money,
}: {
  detail: QuotationRequestDetail;
  money: (value: string | null | undefined) => string;
}) {
  const t = useTranslations('procurement.quotes.decision.context');
  // On a phone only project and waiting show until asked, so the photos and totals come first.
  const [more, setMore] = useState(false);
  const extra = more ? '' : 'hidden sm:block';
  const tWaiting = useTranslations('procurement.quotes.waiting');
  const items = detail.lines.map((line) => line.description).join(', ');
  return (
    <>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-body-sm sm:grid-cols-3 lg:grid-cols-6">
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">{t('project')}</dt>
          <dd className="truncate font-medium text-foreground">{detail.project?.name ?? '—'}</dd>
        </div>
        <div className={cn('col-span-2 min-w-0 sm:col-span-1 lg:col-span-2', extra)}>
          <dt className="text-caption text-muted-foreground">{t('items')}</dt>
          <dd className="font-medium text-foreground">
            {t('itemsSummary', { count: detail.lines.length })}
            {items ? (
              <span className="block truncate font-normal text-muted-foreground">{items}</span>
            ) : null}
          </dd>
        </div>
        {detail.moneyVisible ? (
          <div className={cn('min-w-0', extra)}>
            <dt className="text-caption text-muted-foreground">{t('estimate')}</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {detail.estimateAmount ? money(detail.estimateAmount) : t('notEstimated')}
            </dd>
          </div>
        ) : null}
        {detail.moneyVisible && detail.boqRemainingAmount ? (
          <div className={cn('min-w-0', extra)}>
            <dt className="text-caption text-muted-foreground">{t('boqRemaining')}</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {money(detail.boqRemainingAmount)}
            </dd>
          </div>
        ) : null}
        <div className={cn('min-w-0', extra)}>
          <dt className="text-caption text-muted-foreground">{t('neededBy')}</dt>
          <dd className="font-medium text-foreground">
            {formatDate(detail.materialRequest.requiredByDate ?? null) ?? t('noDate')}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">{t('waiting')}</dt>
          <dd>
            {WAITING_STATUSES.has(detail.status) ? (
              <WaitingTime minutes={detail.waitingWorkingMinutes} tone={detail.slaTone} />
            ) : (
              <span className="font-medium text-foreground">
                {tWaiting(`state.${detail.status}`)}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <Button
        type="button"
        variant="link"
        className="mt-1 h-auto min-h-11 px-0 sm:hidden"
        aria-expanded={more}
        onClick={() => setMore((v) => !v)}
      >
        {more ? t('less') : t('more')}
      </Button>
    </>
  );
}

function QuotePhotos({ quote, onOpen }: { quote: Quote; onOpen: (page: number) => void }) {
  const t = useTranslations('procurement.quotes.decision');
  const tCapture = useTranslations('procurement.quotes.capture');
  const [page, setPage] = useState(0);
  const photo = quote.photos[page] ?? quote.photos[0];
  // Withheld for this role (photosVisible: false): say so, with the page count — no empty box.
  if (!photo) return <PhotosHidden count={photoCountOf(quote)} className="aspect-[3/4] w-full" />;
  return (
    <div>
      <button
        type="button"
        className="group relative block w-full overflow-hidden rounded-control bg-muted focus-visible:outline-none focus-visible:shadow-ring"
        aria-label={`${t('zoom')}: ${tCapture('photoAlt', { store: quote.store.name, page: page + 1 })}`}
        onClick={() => onOpen(page)}
      >
        <QuotePhotoImage
          fileId={photo.fileId}
          alt={tCapture('photoAlt', { store: quote.store.name, page: page + 1 })}
          className="aspect-[4/5] max-h-[55dvh] w-full lg:aspect-[3/4] lg:max-h-none"
          fit="contain"
        />
        <span
          className="absolute end-2 top-2 rounded-full bg-black/60 p-2 text-white"
          aria-hidden="true"
        >
          <Expand className="size-4" />
        </span>
      </button>
      {quote.photos.length > 1 ? (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {quote.photos.map((p, index) => (
            <button
              key={p.fileId}
              type="button"
              aria-label={tCapture('photoAlt', { store: quote.store.name, page: index + 1 })}
              aria-pressed={index === page}
              className={cn(
                'size-12 shrink-0 overflow-hidden rounded-control border-2',
                index === page ? 'border-brand-primary' : 'border-transparent',
              )}
              onClick={() => setPage(index)}
            >
              <QuotePhotoImage fileId={p.fileId} alt="" className="size-full" compact />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PhotoMeta({ quote }: { quote: Quote }) {
  const t = useTranslations('procurement.quotes.decision');
  const tSource = useTranslations('procurement.quotes.source');
  const first = quote.photos[0];
  if (!first) return null;
  const reused = [...new Set(quote.photos.flatMap((p) => p.reusedOn ?? []))];
  const time = first.capturedAt
    ? new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      }).format(new Date(first.capturedAt))
    : '—';
  return (
    <div className="mt-1 space-y-1">
      <p className="text-caption text-muted-foreground">
        {t('capturedAt', { source: tSource(first.source), time })}
      </p>
      {reused.length > 0 ? (
        <p className="flex items-start gap-1 text-caption font-medium text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('reused', { numbers: reused.join(', ') })}
        </p>
      ) : null}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState | undefined }) {
  const t = useTranslations('procurement.quotes.decision');
  return (
    <p aria-live="polite" className="mt-1 min-h-5 text-caption">
      {state === 'saving' ? <span className="text-muted-foreground">{t('saving')}</span> : null}
      {state === 'saved' ? (
        <span className="inline-flex items-center gap-1 text-success">
          <Check className="size-3.5" aria-hidden="true" />
          {t('saved')}
        </span>
      ) : null}
      {state === 'failed' ? <span className="text-danger">{t('saveFailed')}</span> : null}
    </p>
  );
}

function RejectedList({ quotes }: { quotes: Quote[] }) {
  const t = useTranslations('procurement.quotes.decision');
  const tReason = useTranslations('procurement.quotes.rejectReason');
  return (
    <ul className="space-y-1 text-body-sm text-muted-foreground">
      {quotes.map((quote) => (
        <li key={quote.id}>
          <span className="font-medium text-foreground">{quote.store.name}</span> ·{' '}
          {t('rejected', { reason: quote.rejectReason ? tReason(quote.rejectReason) : '—' })}
          {quote.rejectNote ? ` — ${quote.rejectNote}` : ''}
        </li>
      ))}
    </ul>
  );
}

function RejectDialog({
  quote,
  busy,
  error,
  onReject,
  onClose,
}: {
  quote: Quote;
  busy: boolean;
  error: string | null;
  onReject: (reason: QuoteRejectReason, note?: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.quotes.decision');
  const tReason = useTranslations('procurement.quotes.rejectReason');
  const tCommon = useTranslations('common');
  const [reason, setReason] = useState<QuoteRejectReason | ''>('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const noteMissing = reason === 'OTHER' && note.trim() === '';
  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('rejectTitle', { store: quote.store.name })}
      subtitle={t('rejectSubtitle')}
      busy={busy}
      dirty={Boolean(reason || note)}
      closeLabel={tCommon('close')}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!reason || noteMissing) return;
        onReject(reason, note.trim() || undefined);
      }}
    >
      <FormDialogBody className="space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <ChoiceCards
          label={t('rejectReasonLabel')}
          value={reason}
          onChange={setReason}
          columns={2}
          options={REJECT_REASONS.map((value) => ({ value, label: tReason(value) }))}
        />
        {reason === 'OTHER' || note ? (
          <FormField
            htmlFor="reject-note"
            label={t('rejectNote')}
            required={reason === 'OTHER'}
            error={tried && noteMissing ? t('askNoteRequired') : undefined}
          >
            <Textarea
              id="reject-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
        ) : null}
        {tried && !reason ? (
          <p role="alert" className="text-caption text-danger">
            {t('rejectReasonLabel')}
          </p>
        ) : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" variant="destructive" className="min-h-11" loading={busy}>
          {t('rejectConfirm')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}

function AskAnotherDialog({
  busy,
  error,
  onSend,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onSend: (note: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.quotes.decision');
  const tCommon = useTranslations('common');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const suggestions = ['oneMore', 'unreadable', 'wrongItems'] as const;
  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('askTitle')}
      subtitle={t('askSubtitle')}
      busy={busy}
      dirty={note.trim() !== ''}
      closeLabel={tCommon('close')}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (note.trim()) onSend(note.trim());
      }}
    >
      <FormDialogBody className="space-y-4">
        {error ? <Alert variant="error" messages={[error]} /> : null}
        <div>
          <p className="mb-2 text-caption font-semibold text-muted-foreground">
            {t('askSuggestions')}
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                className="min-h-11 rounded-full"
                onClick={() => setNote(t(`askSuggestion.${key}`))}
              >
                {t(`askSuggestion.${key}`)}
              </Button>
            ))}
          </div>
        </div>
        <FormField
          htmlFor="ask-another-note"
          label={t('askNote')}
          required
          error={tried && !note.trim() ? t('askNoteRequired') : undefined}
        >
          <Textarea
            id="ask-another-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" className="min-h-11" loading={busy}>
          {t('askConfirm')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
