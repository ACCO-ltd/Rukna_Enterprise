'use client';

/**
 * ─── Procurement — "Cash released, go pay" + receipt capture (ADR-045, wireframe D, P12) ──
 *
 * The buyer is on a phone at the store counter. The card says, in four clear steps, where the
 * money is (waiting for cash → cash released → receipt sent → settled), shows the amount
 * released when their role may see it (Procurement Manager holds view:commitment-ledger), and
 * puts one big button under the thumb: *Photograph the receipt*.
 *
 * Capture reuses the Phase 1 camera and the resumable upload queue: pages upload the moment they
 * are taken (weak signal is normal), the buyer taps *Send receipt* once, and the queue creates the
 * store document idempotently on its `clientRef` — across a dropped connection or a reload.
 *
 * There is no amount field anywhere: finance reads the total from the photo (ADR-044 principle 2).
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Notice, cn } from '@erp/ui';
import { Camera, CircleCheck, Plus, RotateCw, X } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { QUOTATION_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, sumMinorUnits } from '@/lib/money';

import { useObjectUrl, useStoreDocumentUploads, useUploadQueue } from '../../hooks/use-quote-uploads';
import { useStoreDocuments, useWithdrawStoreDocument } from '../../hooks/use-quotation-payment';
import { preparePhoto } from '../../quotations/capture/prepare';
import type { CaptureVia } from '../../quotations/capture/photo-source';
import type { QueueItemView, QueuedPage } from '../../quotations/capture/upload-queue';
import { buyerStage, findPaymentAction, type BuyerStage } from '../../quotations/payment-rules';
import type { QuotationPayment, StoreDocumentKind, StoreDocumentSummary } from '../../quotations/payment-types';
import type { QuotationRequestDetail } from '../../quotations/types';
import { StoreDocumentStatusPill, usePaymentRefusalText } from './payment-shared';
import { usePhotoPicker } from './photo-picker';

const MAX_PAGES = 10;
const STAGES: BuyerStage[] = ['waiting', 'released', 'sent', 'settled'];

export function BuyerPaymentCard({ detail }: { detail: QuotationRequestDetail }) {
  const payment = detail.payment;
  if (detail.status !== 'AWARDED' || !payment || !payment.purchaseOrder) return null;
  return <CardBody detail={detail} payment={payment} purchaseOrderId={payment.purchaseOrder.id} />;
}

function CardBody({
  detail,
  payment,
  purchaseOrderId,
}: {
  detail: QuotationRequestDetail;
  payment: QuotationPayment;
  purchaseOrderId: string;
}) {
  const t = useTranslations('procurement.quotes.payment.buyer');
  const tDocs = useTranslations('procurement.quotes.payment.documents');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();
  const session = useSession();
  const { fromCode } = usePaymentRefusalText();
  const queue = useUploadQueue();
  const uploads = useStoreDocumentUploads(detail.id);
  const [preparing, setPreparing] = useState(0);
  const [withdrawing, setWithdrawing] = useState<StoreDocumentSummary | null>(null);
  const { fromError } = usePaymentRefusalText();
  const withdraw = useWithdrawStoreDocument(detail.id);
  // The payment block has no reject reason / uploader id: the store-document list does.
  const needsRows = payment.storeDocuments.some((d) => d.status === 'REJECTED' || d.status === 'SUBMITTED');
  const rows = useStoreDocuments(purchaseOrderId, { enabled: needsRows });
  const fullRow = (id: string) => rows.data?.find((r) => r.id === id) ?? null;

  const cash = payment.path === 'BUYER_CASH';
  const path = cash ? 'cash' : 'supplier';
  const stage = buyerStage(payment);
  const store = detail.award?.supplier?.name ?? detail.quotes.find((q) => q.id === detail.award?.quoteId)?.store.name ?? '—';
  const kind: StoreDocumentKind = cash ? 'RECEIPT' : 'INVOICE';
  const me = session.user?.id ?? null;

  // Cash released to me: by id when the server sends it, else every advance shown to me is mine.
  const advances = payment.advances ?? [];
  const mine = advances.filter((a) => (a.recipientUserId ? a.recipientUserId === me : true));
  const recipientName = advances.at(-1)?.recipientName ?? null;
  const toMe =
    advances.some((a) => a.recipientUserId === me) ||
    (recipientName !== null && Boolean(session.user?.name) && recipientName === session.user?.name);
  const amountMinor = sumMinorUnits(mine.map((a) => a.amount), MONEY_SCALE);
  const amountKnown = payment.moneyVisible && mine.length > 0 && mine.every((a) => a.amount !== null);
  const amount = amountKnown ? formatMoney(fromMinorUnits(amountMinor, MONEY_SCALE), detail.currencyCode ?? 'USD', locale) : null;

  const photograph = findPaymentAction(payment, 'PHOTOGRAPH_RECEIPT');
  const mayCapture = can(QUOTATION_PERMISSIONS.collect) && photograph !== null;
  const draft = uploads.find((item) => item.target && !item.target.sent) ?? null;
  const sending = uploads.filter((item) => item.target?.sent);

  const onPicked = (picked: File[], via: CaptureVia) => {
    const room = MAX_PAGES - (draft?.pages.length ?? 0);
    const files = picked.slice(0, Math.max(0, room));
    if (files.length === 0) return;
    setPreparing((n) => n + files.length);
    void (async () => {
      try {
        let ref = draft?.clientRef ?? null;
        for (const file of files) {
          const photo = await preparePhoto(file, via);
          if (ref) await queue.addPage(ref, photo);
          else ref = await queue.captureStoreDocument(detail.id, { purchaseOrderId, kind }, photo);
          setPreparing((n) => Math.max(0, n - 1));
        }
      } catch {
        setPreparing(0);
      }
    })();
  };
  const picker = usePhotoPicker(onPicked);

  return (
    <section
      aria-labelledby="buyer-payment-title"
      className={cn(
        'space-y-4 rounded-panel border p-4',
        stage === 'released' ? 'border-success/40 bg-success-subtle' : 'border-border bg-surface',
      )}
    >
      <h2 id="buyer-payment-title" className="sr-only">
        {t('title')}
      </h2>

      {/* ── Four steps, written — never colour alone ───────────────────────── */}
      <ol className="grid grid-cols-4 gap-1" aria-label={t('stepsLabel')}>
        {STAGES.map((s, index) => {
          const reached = STAGES.indexOf(stage) >= index;
          const current = s === stage;
          return (
            <li key={s} className="min-w-0" aria-current={current ? 'step' : undefined}>
              <span
                className={cn('block h-1.5 rounded-full', reached ? 'bg-success' : 'bg-border-strong')}
                aria-hidden="true"
              />
              <span
                className={cn(
                  'mt-1 block text-caption leading-tight',
                  current ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {t(`steps.${path}.${s}`)}
              </span>
            </li>
          );
        })}
      </ol>

      {/* ── Where the money is ───────────────────────────────────────────────── */}
      {stage === 'waiting' ? (
        <div>
          <p className="text-body font-semibold text-foreground">{t(`waiting.${path}.title`)}</p>
          <p className="text-body-sm text-muted-foreground">
            {payment.state === 'AWAITING_APPROVAL'
              ? t('waiting.approval')
              : payment.state === 'AWAITING_ORDER'
                ? t('waiting.order')
                : t(`waiting.${path}.body`)}
          </p>
        </div>
      ) : null}

      {stage === 'released' && cash ? (
        <div>
          <p className="flex items-center gap-2 text-body font-semibold text-foreground">
            <CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
            {payment.advances === null
              ? t('released.generic')
              : toMe || !recipientName
                ? t('released.toYou')
                : t('released.toName', { name: recipientName })}
          </p>
          {amount ? (
            <p className="mt-1 text-h2 font-semibold tabular-nums text-foreground">{amount}</p>
          ) : (
            <p className="mt-1 text-body-sm text-muted-foreground">{t('released.amountHidden')}</p>
          )}
          <p className="mt-1 text-body-sm text-foreground">{t('released.next', { store })}</p>
        </div>
      ) : null}

      {stage === 'released' && !cash ? (
        <div>
          <p className="flex items-center gap-2 text-body font-semibold text-foreground">
            <CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
            {t('paid.title', { store })}
          </p>
          <p className="mt-1 text-body-sm text-foreground">{t('paid.next')}</p>
        </div>
      ) : null}

      {stage === 'sent' ? (
        <p className="text-body-sm text-foreground">{t(`sent.${path}`)}</p>
      ) : null}

      {stage === 'settled' ? (
        <Notice tone="success" title={t('settled.title')}>
          <p className="mt-1">{t('settled.body')}</p>
        </Notice>
      ) : null}

      {/* ── Capture ──────────────────────────────────────────────────────────── */}
      {mayCapture && stage !== 'settled' ? (
        <div className="space-y-3">
          {draft ? (
            <ul className="flex flex-wrap gap-2" aria-label={t(`capture.pagesLabel.${path}`)}>
              {draft.pages.map((page, index) => (
                <PageThumb key={page.id} page={page} index={index} kind={kind} />
              ))}
              {draft.pages.length < MAX_PAGES ? (
                <li>
                  <button
                    type="button"
                    onClick={picker.openCamera}
                    className="flex h-20 w-16 items-center justify-center rounded-control border border-dashed border-border-strong bg-surface text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                    aria-label={t('capture.addPage')}
                  >
                    <Plus className="size-5" aria-hidden="true" />
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}

          {!draft ? (
            <div className="space-y-1 text-center">
              <Button
                type="button"
                size="lg"
                className="h-14 w-full text-base"
                disabled={!photograph?.enabled}
                aria-describedby={!photograph?.enabled && photograph?.reason ? 'buyer-capture-reason' : undefined}
                onClick={picker.openCamera}
              >
                <Camera className="size-5" aria-hidden="true" />
                {t(`capture.snap.${path}`)}
              </Button>
              {photograph?.enabled ? (
                <Button type="button" variant="link" className="min-h-11" onClick={picker.openGallery}>
                  {t('capture.fromGallery')}
                </Button>
              ) : photograph?.reason ? (
                <p id="buyer-capture-reason" className="text-body-sm text-muted-foreground">
                  {fromCode(photograph.reason) ?? photograph.reason}
                </p>
              ) : null}
              <p className="text-caption text-muted-foreground">{t('capture.noAmount')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <Button
                type="button"
                size="lg"
                className="h-14 w-full text-base"
                disabled={preparing > 0}
                onClick={() => void queue.sendStoreDocument(draft.clientRef)}
              >
                {t(`capture.send.${path}`)}
              </Button>
              <DraftState item={draft} preparing={preparing} />
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-muted-foreground"
                  onClick={() => void queue.discard(draft.clientRef)}
                >
                  <X className="size-4" aria-hidden="true" />
                  {t('capture.discard')}
                </Button>
              </div>
            </div>
          )}
          {picker.inputs}
        </div>
      ) : null}

      {/* ── Sending, and what finance has ─────────────────────────────────────── */}
      {sending.map((item) => (
        <SendingRow
          key={item.clientRef}
          item={item}
          onRetry={() => void queue.retry(item.clientRef)}
          onDiscard={() => void queue.discard(item.clientRef)}
        />
      ))}
      {payment.storeDocuments.length > 0 ? (
        <ul className="space-y-2" aria-label={tDocs('title')}>
          {payment.storeDocuments.filter((d) => d.status !== 'WITHDRAWN').map((summary) => {
            const doc = { ...summary, ...(fullRow(summary.id) ?? {}) };
            const mine = Boolean(me) && doc.uploadedBy?.id === me;
            return (
            <li key={doc.id} className="rounded-control border border-border bg-surface px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-body-sm font-medium text-foreground">
                  {tDocs(`kind.${doc.kind}`)} {doc.number}
                  <span className="block text-caption font-normal text-muted-foreground">
                    {formatDate(doc.createdAt, locale)}
                  </span>
                </span>
                <StoreDocumentStatusPill status={doc.status} />
              </div>
              {doc.status === 'REJECTED' ? (
                <p className="mt-1 text-body-sm text-danger">
                  {doc.rejectReason ? tDocs(`rejectReason.${doc.rejectReason}`) : null}
                  {doc.rejectNote ? ` — ${doc.rejectNote}` : ''}
                  <span className="block text-muted-foreground">{t('rejectedAgain')}</span>
                </p>
              ) : null}
              {doc.status === 'SUBMITTED' && mine ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 min-h-11 px-0 text-muted-foreground"
                  onClick={() => setWithdrawing(doc)}
                >
                  {t('withdraw.action')}
                </Button>
              ) : null}
            </li>
            );
          })}
        </ul>
      ) : null}
      {withdrawing ? (
        <ConfirmActionDialog
          title={t('withdraw.title', { number: withdrawing.number })}
          description={t('withdraw.body')}
          confirmLabel={t('withdraw.confirm')}
          destructive
          isPending={withdraw.isPending}
          errorMessage={withdraw.error ? fromError(withdraw.error) : undefined}
          onConfirm={() => withdraw.mutate(withdrawing.id, { onSuccess: () => setWithdrawing(null) })}
          onDismiss={() => {
            withdraw.reset();
            setWithdrawing(null);
          }}
        />
      ) : null}
    </section>
  );
}

function PageThumb({ page, index, kind }: { page: QueuedPage; index: number; kind: StoreDocumentKind }) {
  const t = useTranslations('procurement.quotes.payment.buyer.capture');
  const tDocs = useTranslations('procurement.quotes.payment.documents');
  const url = useObjectUrl(page.file);
  return (
    <li className="relative h-20 w-16 overflow-hidden rounded-control border border-border bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={t('pageAlt', { kind: tDocs(`kind.${kind}`), page: index + 1 })} className="size-full object-cover" />
      ) : null}
      <span className="absolute bottom-0.5 end-0.5 rounded-full bg-background/90 px-1.5 text-micro font-semibold tabular-nums text-foreground">
        {index + 1}
      </span>
      {page.fileId ? (
        <CircleCheck className="absolute start-0.5 top-0.5 size-4 rounded-full bg-background text-success" aria-label={t('pageUploaded')} />
      ) : null}
    </li>
  );
}

function DraftState({ item, preparing }: { item: QueueItemView; preparing: number }) {
  const t = useTranslations('procurement.quotes.payment.buyer.capture');
  const text =
    preparing > 0 || item.phase === 'uploading'
      ? t('state.uploading')
      : item.phase === 'offline'
        ? t('state.offline')
        : item.phase === 'retrying'
          ? t('state.retrying')
          : t('state.ready', { count: item.pages.length });
  return (
    <p aria-live="polite" className="text-center text-caption text-muted-foreground">
      {text}
    </p>
  );
}

function SendingRow({ item, onRetry, onDiscard }: { item: QueueItemView; onRetry: () => void; onDiscard: () => void }) {
  const t = useTranslations('procurement.quotes.payment.buyer.capture');
  const { fromCode } = usePaymentRefusalText();
  if (item.phase === 'failed') {
    return (
      <div className="space-y-1 rounded-control border border-danger/40 bg-surface px-3 py-2" role="alert">
        <p className="text-body-sm text-danger">{fromCode(item.failureCode) ?? t('state.failed')}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onRetry}>
            <RotateCw className="size-4" aria-hidden="true" />
            {t('retry')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground" onClick={onDiscard}>
            {t('discard')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <p aria-live="polite" className="rounded-control bg-surface px-3 py-2 text-body-sm text-muted-foreground">
      {item.phase === 'offline'
        ? t('state.sendingOffline')
        : item.phase === 'retrying'
          ? t('state.retrying')
          : t('state.sending', { count: item.pages.length })}
    </p>
  );
}
