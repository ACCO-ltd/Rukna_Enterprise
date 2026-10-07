'use client';

/**
 * ─── Capture screen — `/procurement/quotes/[id]` (ADR-044, spec Q11, wireframes B and C) ─────
 *
 * Built for a buyer in a market: one hand, a phone, weak signal, ~30 seconds. Snap → tap a store
 * → snap → tap → snap → tap → Send. No price field anywhere — finance reads prices from the
 * photos. Every photo shows its own state (uploading / saved / failed — tap to retry) and the
 * upload queue keeps going across a dropped signal or a reload.
 *
 * After sending, the same route is the waiting screen (read-only photos, time waiting, reopen
 * behind a confirm). Returned requests show finance's note above the camera.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, ChoiceCards, Notice, Progress, Skeleton, cn } from '@erp/ui';
import { Camera, ChevronLeft, CircleCheck, RotateCw, Trash2 } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { QUOTATION_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';

import { useObjectUrl, useQuoteUploads, useUploadQueue } from '../../hooks/use-quote-uploads';
import {
  useCancelQuotationRequest,
  useQuotationRequest,
  useReopenQuotationRequest,
  useSendQuotationRequest,
  useWithdrawQuote,
} from '../../hooks/use-quotations';
import { preparePhoto } from '../../quotations/capture/prepare';
import type { CaptureVia } from '../../quotations/capture/photo-source';
import type { QueueItemView, StoreChoice } from '../../quotations/capture/upload-queue';
import {
  COLLECTING_STATUSES,
  WAITING_STATUSES,
  actionEnabled,
  activeQuotes,
  collectTarget,
  sendBlock,
  storeKey,
} from '../../quotations/quote-rules';
import { readRecentStores, rememberStore } from '../../quotations/recent-stores';
import type {
  Quote,
  QuotationRequestDetail,
  QuoteCountExceptionReason,
} from '../../quotations/types';
import { OrderCard } from './order-raise';
import { usePhotoPicker } from './photo-picker';
import {
  LocalPhoto,
  QuotationStatusPill,
  QuotePhotoImage,
  StoreDots,
  useDurationText,
  useRefusalText,
} from './quote-shared';
import { StoreSheet } from './store-sheet';

const MAX_PAGES_PER_QUOTE = 10;
const EXCEPTION_REASONS: QuoteCountExceptionReason[] = ['ONLY_ONE_SUPPLIER', 'URGENT', 'FRAMEWORK_SUPPLIER'];

/** Where the next picked photo goes. */
type PickTarget = { kind: 'new' } | { kind: 'pending'; clientRef: string } | { kind: 'quote'; quoteId: string };

export function QuoteCaptureScreen({ id }: { id: string }) {
  const t = useTranslations('procurement.quotes.capture');
  const tq = useTranslations('procurement.quotes');
  const detail = useQuotationRequest(id, {
    poll: (data) => (data ? WAITING_STATUSES.has(data.status) : false),
  });
  useModuleTrail(detail.data?.number);

  if (detail.isPending) {
    return (
      <div role="status" className="mx-auto w-full max-w-xl space-y-3">
        <span className="sr-only">{t('header', { number: '', mrNumber: '' })}</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        <Alert variant="error" messages={[tq('loadFailed')]} />
        <Button variant="outline" className="min-h-11" onClick={() => void detail.refetch()}>
          {tq('retry')}
        </Button>
      </div>
    );
  }
  return <CaptureBody detail={detail.data} />;
}

function CaptureBody({ detail }: { detail: QuotationRequestDetail }) {
  const t = useTranslations('procurement.quotes.capture');
  const tq = useTranslations('procurement.quotes');
  const tReason = useTranslations('procurement.quotes.exceptionReason');
  const refusal = useRefusalText();
  const { can } = usePermissions();
  const session = useSession();
  const owner = session.user ? `${session.user.orgId}:${session.user.id}` : null;
  const queue = useUploadQueue();
  const pending = useQuoteUploads(detail.id);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mayCollect = can(QUOTATION_PERMISSIONS.collect);
  const collecting = COLLECTING_STATUSES.has(detail.status) && mayCollect;
  const saved = activeQuotes(detail.quotes);
  const target = collectTarget(detail);

  const [recent, setRecent] = useState<StoreChoice[]>(() => readRecentStores(owner));
  // A snap from the MR's "Get quotes" lands here with ?store=<clientRef>: its store sheet opens.
  const storeParam = searchParams.get('store');
  const [sheetFor, setSheetFor] = useState<string | null>(storeParam);
  const [pickTarget, setPickTarget] = useState<PickTarget>({ kind: 'new' });
  const [reason, setReason] = useState<QuoteCountExceptionReason | ''>(detail.exceptionReason ?? '');
  const [withdrawing, setWithdrawing] = useState<Quote | null>(null);
  const [reopening, setReopening] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [preparing, setPreparing] = useState(0);

  const send = useSendQuotationRequest(detail.id);
  const withdraw = useWithdrawQuote(detail.id);
  const reopen = useReopenQuotationRequest(detail.id);
  const cancel = useCancelQuotationRequest(detail.id);

  // Drop the hand-off parameter so a reload does not reopen the sheet.
  useEffect(() => {
    if (storeParam) router.replace(pathname);
  }, [storeParam, router, pathname]);

  // Distinct stores so far: saved quotes plus photos still uploading that already have a store.
  const usedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const quote of saved) keys.add(storeKey({ supplierId: quote.store.supplierId, name: quote.store.name }));
    for (const item of pending) if (item.store && item.quoteId === null) keys.add(storeKey(item.store));
    return keys;
  }, [saved, pending]);
  const newPending = pending.filter((item) => item.quoteId === null);
  const count = usedKeys.size;
  const short = count < target;

  const block = sendBlock({
    pending: pending.map((item) => ({ phase: item.phase })),
    savedDistinct: detail.distinctSupplierCount ?? count,
    savedCount: saved.length,
    target,
    exceptionReason: reason || null,
  });
  const preparingBlock = preparing > 0 ? { kind: 'uploading' as const, count: preparing } : null;
  const effectiveBlock = preparingBlock ?? block;

  const onPicked = (picked: File[], via: CaptureVia) => {
    // A quote takes at most 10 photos (server rule); a gallery pick beyond that is cut, not refused.
    const files = picked.slice(0, MAX_PAGES_PER_QUOTE);
    const target = pickTarget;
    setPickTarget({ kind: 'new' });
    setPreparing((n) => n + files.length);
    void (async () => {
      try {
        let clientRef = target.kind === 'pending' ? target.clientRef : null;
        for (const file of files) {
          const photo = await preparePhoto(file, via);
          if (target.kind === 'quote') {
            await queue.capturePageForQuote(detail.id, target.quoteId, photo);
          } else if (clientRef) {
            await queue.addPage(clientRef, photo);
          } else {
            clientRef = await queue.capture(detail.id, photo);
            if (clientRef) setSheetFor(clientRef);
          }
          setPreparing((n) => Math.max(0, n - 1));
        }
      } catch {
        setPreparing(0);
      }
    })();
  };
  const picker = usePhotoPicker(onPicked);

  const sheetItem = sheetFor ? pending.find((item) => item.clientRef === sheetFor) ?? null : null;

  const chooseStore = (choice: StoreChoice) => {
    if (!sheetFor) return;
    void queue.setStore(sheetFor, choice);
    setRecent(rememberStore(owner, choice));
    setSheetFor(null);
  };

  const mayReopen =
    detail.status === 'AWAITING_DECISION' && mayCollect && actionEnabled(detail.allowedActions, 'REOPEN', true);
  const mayCancel =
    mayCollect &&
    detail.status !== 'CANCELLED' &&
    actionEnabled(detail.allowedActions, 'CANCEL', detail.status !== 'AWARDED' || !detail.purchaseOrder);

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 pb-8">
      <Link
        href="/procurement/quotes"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('back')}
      </Link>

      {/* ── Sticky header: the request and the store counter ───────────────── */}
      <header className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-panel sm:border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-body font-semibold text-foreground">
            {t('header', { number: detail.number, mrNumber: detail.materialRequest.number })}
          </h1>
          <QuotationStatusPill status={detail.status} />
        </div>
        {detail.materialRequest.title ? (
          <p className="mt-0.5 truncate text-caption text-muted-foreground">{detail.materialRequest.title}</p>
        ) : null}
        {/* The counter matters while quotes are collected or with finance; after a choice it is noise. */}
        {COLLECTING_STATUSES.has(detail.status) || detail.status === 'AWAITING_DECISION' ? (
          <div className="mt-2 flex items-center gap-2" aria-live="polite">
            <StoreDots count={count} target={target} />
            <span className={cn('text-body-sm font-semibold', count >= target ? 'text-success' : 'text-foreground')}>
              {t('counterLabel', { count, required: target })}
            </span>
            {count >= target ? <CircleCheck className="size-4 text-success" aria-label={t('counterDone')} /> : null}
          </div>
        ) : null}
      </header>

      <StatusNotice detail={detail} />
      {detail.status === 'AWARDED' ? <OrderCard detail={detail} /> : null}

      {/* ── Quotes ─────────────────────────────────────────────────────────── */}
      {collecting ? (
        <>
          <ul className="space-y-3" aria-label={tq('title')}>
            {saved.map((quote) => (
              <SavedQuoteCard
                key={quote.id}
                quote={quote}
                extraPages={pending.filter((item) => item.quoteId === quote.id)}
                onAddPage={() => {
                  setPickTarget({ kind: 'quote', quoteId: quote.id });
                  picker.openCamera();
                }}
                onRemove={() => setWithdrawing(quote)}
                onRetry={(ref) => void queue.retry(ref)}
                onDiscard={(ref) => void queue.discard(ref)}
              />
            ))}
            {newPending.map((item) => (
              <PendingQuoteCard
                key={item.clientRef}
                item={item}
                onChooseStore={() => setSheetFor(item.clientRef)}
                onRetry={() => void queue.retry(item.clientRef)}
                onDiscard={() => void queue.discard(item.clientRef)}
              />
            ))}
          </ul>
          {saved.length === 0 && newPending.length === 0 ? (
            <p className="rounded-panel border border-dashed border-border-strong p-4 text-body-sm text-muted-foreground">
              {t('noQuotes')}
            </p>
          ) : null}

          {/* ── Snap ─────────────────────────────────────────────────────── */}
          <div className="space-y-1 text-center">
            <Button
              type="button"
              size="lg"
              variant={count >= target ? 'outline' : 'default'}
              className="h-14 w-full text-base"
              onClick={() => {
                setPickTarget({ kind: 'new' });
                picker.openCamera();
              }}
            >
              <Camera className="size-5" aria-hidden="true" />
              {t('snap')}
            </Button>
            <Button
              type="button"
              variant="link"
              className="min-h-11"
              onClick={() => {
                setPickTarget({ kind: 'new' });
                picker.openGallery();
              }}
            >
              {t('fromGallery')}
            </Button>
            <p className="text-caption text-muted-foreground">{t('noPrices')}</p>
            {picker.inputs}
          </div>

          {/* ── Fewer stores than needed: a reason chip, no typing ───────── */}
          {short && saved.length + newPending.length > 0 ? (
            <ChoiceCards
              label={t('short.title', { count })}
              value={reason}
              onChange={setReason}
              columns={1}
              options={EXCEPTION_REASONS.map((value) => ({ value, label: tReason(value) }))}
            />
          ) : null}

          {/* ── Send ─────────────────────────────────────────────────────── */}
          <div className="space-y-2">
            {send.error ? <Alert variant="error" messages={[refusal(send.error) ?? '']} /> : null}
            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-base"
              disabled={effectiveBlock !== null}
              loading={send.isPending}
              loadingText={t('sending')}
              aria-describedby="quote-send-hint"
              onClick={() => send.mutate(short && reason ? reason : undefined)}
            >
              {t('send')}
            </Button>
            <p id="quote-send-hint" aria-live="polite" className="min-h-5 text-center text-caption text-muted-foreground">
              {effectiveBlock ? <SendBlockText block={effectiveBlock} /> : null}
            </p>
          </div>
        </>
      ) : (
        <ReadOnlyQuotes quotes={saved} />
      )}

      {mayReopen ? (
        <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => setReopening(true)}>
          {t('waiting.reopen')}
        </Button>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <Link
          href={`/procurement/requests/${detail.materialRequest.id}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-primary underline underline-offset-4"
        >
          {t('mrLink', { number: detail.materialRequest.number })}
        </Link>
        {mayCancel ? (
          <Button type="button" variant="ghost" className="min-h-11 text-muted-foreground" onClick={() => setCancelling(true)}>
            {t('cancel')}
          </Button>
        ) : null}
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      <StoreSheet
        open={sheetFor !== null && sheetItem !== null}
        pagesTaken={sheetItem?.pages.length ?? 0}
        recent={recent}
        usedKeys={usedKeys}
        onChoose={chooseStore}
        onAddPage={() => {
          if (!sheetFor) return;
          setPickTarget({ kind: 'pending', clientRef: sheetFor });
          picker.openCamera();
        }}
        onClose={() => setSheetFor(null)}
      />

      {withdrawing ? (
        <ConfirmActionDialog
          title={t('removeTitle', { store: withdrawing.store.name })}
          description={t('removeBody')}
          confirmLabel={t('remove')}
          destructive
          isPending={withdraw.isPending}
          errorMessage={refusal(withdraw.error)}
          onConfirm={() => withdraw.mutate(withdrawing.id, { onSuccess: () => setWithdrawing(null) })}
          onDismiss={() => {
            withdraw.reset();
            setWithdrawing(null);
          }}
        />
      ) : null}

      {reopening ? (
        <ConfirmActionDialog
          title={t('waiting.reopenTitle', { number: detail.number })}
          description={t('waiting.reopenBody')}
          confirmLabel={t('waiting.reopenConfirm')}
          reason={{ label: t('waiting.reopenReason'), required: true }}
          isPending={reopen.isPending}
          errorMessage={refusal(reopen.error)}
          onConfirm={(text) => reopen.mutate(text, { onSuccess: () => setReopening(false) })}
          onDismiss={() => {
            reopen.reset();
            setReopening(false);
          }}
        />
      ) : null}

      {cancelling ? (
        <ConfirmActionDialog
          title={t('cancelTitle', { number: detail.number })}
          description={t('cancelBody')}
          confirmLabel={t('cancelConfirm')}
          reason={{ label: t('cancelReason'), required: true }}
          destructive
          isPending={cancel.isPending}
          errorMessage={refusal(cancel.error)}
          onConfirm={(text) => cancel.mutate(text, { onSuccess: () => setCancelling(false) })}
          onDismiss={() => {
            cancel.reset();
            setCancelling(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Status notices ────────────────────────────────────────────────────────────

function StatusNotice({ detail }: { detail: QuotationRequestDetail }) {
  const t = useTranslations('procurement.quotes.capture');
  const duration = useDurationText();
  const sentTime = detail.sentAt
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(detail.sentAt))
    : null;

  if (detail.status === 'RETURNED') {
    return (
      <Notice tone="attention" title={t('returned.title')}>
        {detail.returnNote ? <p className="mt-1 break-words">{t('returned.note', { note: detail.returnNote })}</p> : null}
      </Notice>
    );
  }
  if (detail.status === 'AWAITING_DECISION') {
    return (
      <Notice tone="info" title={t('waiting.title')}>
        <p className="mt-1 tabular-nums">
          {sentTime
            ? t('waiting.sent', { time: sentTime, duration: duration(detail.waitingWorkingMinutes) })
            : null}
        </p>
        <p className="mt-1 text-muted-foreground">{t('waiting.readOnly')}</p>
      </Notice>
    );
  }
  if (detail.status === 'AWARD_PENDING_APPROVAL') {
    const chosen = detail.quotes.find((q) => q.id === detail.proposal?.quoteId);
    return (
      <Notice tone="info" title={t('pending.title', { store: chosen?.store.name ?? '—' })}>
        <p className="mt-1">{t('pending.body')}</p>
      </Notice>
    );
  }
  if (detail.status === 'CANCELLED') {
    return <Notice tone="historical">{t('cancelled')}</Notice>;
  }
  return null;
}

function SendBlockText({ block }: { block: NonNullable<ReturnType<typeof sendBlock>> }) {
  const t = useTranslations('procurement.quotes.capture.blocked');
  switch (block.kind) {
    case 'uploading':
      return <>{t('uploading', { count: block.count })}</>;
    case 'needsStore':
      return <>{t('needsStore', { count: block.count })}</>;
    case 'failed':
      return <>{t('failed', { count: block.count })}</>;
    case 'empty':
      return <>{t('empty')}</>;
    case 'reason':
      return <>{t('reason')}</>;
  }
}

// ─── Quote cards ───────────────────────────────────────────────────────────────

function SavedQuoteCard({
  quote,
  extraPages,
  onAddPage,
  onRemove,
  onRetry,
  onDiscard,
}: {
  quote: Quote;
  extraPages: QueueItemView[];
  onAddPage: () => void;
  onRemove: () => void;
  onRetry: (clientRef: string) => void;
  onDiscard: (clientRef: string) => void;
}) {
  const t = useTranslations('procurement.quotes.capture');
  const first = quote.photos[0];
  return (
    <li className="flex gap-3 rounded-panel border border-border bg-surface p-3 shadow-e1">
      <div className="size-20 shrink-0 overflow-hidden rounded-control bg-muted">
        {first ? (
          <QuotePhotoImage
            fileId={first.fileId}
            alt={t('photoAlt', { store: quote.store.name, page: 1 })}
            className="size-20"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-foreground">
          {quote.store.name}
          {!quote.store.registered ? (
            <span className="ms-1.5 text-caption font-normal text-muted-foreground">({t('newStore')})</span>
          ) : null}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-caption text-success">
          <CircleCheck className="size-3.5" aria-hidden="true" />
          {t('pages', { count: quote.photos.length })} · {t('upload.saved')}
        </p>
        {extraPages.map((item) => (
          <UploadState
            key={item.clientRef}
            item={item}
            label={quote.store.name}
            onRetry={() => onRetry(item.clientRef)}
            onDiscard={() => onDiscard(item.clientRef)}
          />
        ))}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onAddPage}>
            <Camera className="size-4" aria-hidden="true" />
            {t('addPage')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground" onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('remove')}
          </Button>
        </div>
      </div>
    </li>
  );
}

function PendingQuoteCard({
  item,
  onChooseStore,
  onRetry,
  onDiscard,
}: {
  item: QueueItemView;
  onChooseStore: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('procurement.quotes.capture');
  const thumb = useObjectUrl(item.pages[0]?.file);
  const label = item.store?.label ?? t('chooseStore');
  return (
    <li className="flex gap-3 rounded-panel border border-border bg-surface p-3 shadow-e1" data-phase={item.phase}>
      <LocalPhoto
        url={thumb}
        alt={item.store ? t('photoAlt', { store: item.store.label, page: 1 }) : t('photoAltUnnamed', { page: 1 })}
        className="size-20 shrink-0 rounded-control"
      />
      <div className="min-w-0 flex-1">
        {item.store ? (
          <p className="truncate font-semibold text-foreground">
            {item.store.label}
            {!item.store.supplierId ? (
              <span className="ms-1.5 text-caption font-normal text-muted-foreground">({t('newStore')})</span>
            ) : null}
          </p>
        ) : (
          <Button type="button" className="min-h-11" onClick={onChooseStore}>
            {t('chooseStore')}
          </Button>
        )}
        {item.pages.length > 1 ? (
          <p className="text-caption text-muted-foreground">{t('pages', { count: item.pages.length })}</p>
        ) : null}
        <UploadState item={item} label={label} onRetry={onRetry} onDiscard={onDiscard} />
      </div>
    </li>
  );
}

/** One line of upload state, announced politely; a failure is a button (tap to retry). */
function UploadState({
  item,
  label,
  onRetry,
  onDiscard,
}: {
  item: QueueItemView;
  label: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('procurement.quotes.capture.upload');
  if (item.phase === 'failed') {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 border-danger/40 text-danger"
          aria-label={t('retry', { store: label })}
          onClick={onRetry}
        >
          <RotateCw className="size-4" aria-hidden="true" />
          {t('failed')}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground" onClick={onDiscard}>
          {t('discard')}
        </Button>
        <FailureReason code={item.failureCode} />
      </div>
    );
  }
  const text =
    item.phase === 'uploading'
      ? item.progress !== null
        ? t('uploading', { percent: Math.round(item.progress * 100) })
        : t('uploadingNoPercent')
      : item.phase === 'binding'
        ? t('binding')
        : item.phase === 'retrying'
          ? t('retrying')
          : item.phase === 'offline'
            ? t('offline')
            : item.phase === 'needsStore'
              ? t('needsStore')
              : t('queued');
  return (
    <div className="mt-1 space-y-1" aria-live="polite">
      <p
        className={cn(
          'flex items-center gap-1 text-caption',
          item.phase === 'retrying' || item.phase === 'offline' ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {item.phase === 'retrying' ? <RotateCw className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : null}
        {text}
      </p>
      {item.phase === 'uploading' && item.progress !== null ? (
        <Progress value={Math.round(item.progress * 100)} label={text} size="sm" />
      ) : null}
      {item.phase === 'retrying' || item.phase === 'offline' ? (
        <Button type="button" variant="link" size="sm" className="h-auto min-h-11 px-0" onClick={onRetry}>
          {t('retry', { store: label })}
        </Button>
      ) : null}
    </div>
  );
}

function FailureReason({ code }: { code: string | null }) {
  const t = useTranslations('procurement.quotes.refusal');
  if (!code || !t.has(code)) return null;
  return <p className="w-full text-caption text-danger">{t(code)}</p>;
}

function ReadOnlyQuotes({ quotes }: { quotes: Quote[] }) {
  const t = useTranslations('procurement.quotes.capture');
  const tq = useTranslations('procurement.quotes');
  if (quotes.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={tq('title')}>
      {quotes.map((quote) => (
        <li key={quote.id} className="overflow-hidden rounded-panel border border-border bg-surface">
          {quote.photos[0] ? (
            <QuotePhotoImage
              fileId={quote.photos[0].fileId}
              alt={t('photoAlt', { store: quote.store.name, page: 1 })}
              className="aspect-[3/4] w-full"
            />
          ) : (
            <div className="aspect-[3/4] w-full bg-muted" />
          )}
          <p className="truncate px-2 py-1.5 text-caption font-medium text-foreground">{quote.store.name}</p>
        </li>
      ))}
    </ul>
  );
}
