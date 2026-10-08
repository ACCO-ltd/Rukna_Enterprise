'use client';

/**
 * ─── Finance — Record receipt, `/finance/quotes/[id]/receipt/[docId]` (ADR-045 §2, wireframe E) ─
 *
 * The store's paper receipt, photographed by the buyer, big on the left (stacked above on a
 * phone); one Total input on the right — finance keys it from the photo — with the receipt
 * number, the receipt date and the expense account (remembered). One confirm does it all on the
 * server: bill → match → approve → post → settle from the buyer's cash (or the prepayment).
 *
 * The result is said per step: DONE ("Settled $980.00 from Ahmed's cash · $20.00 still with
 * Ahmed" + Change returned / Top up), MATCH_EXCEPTION (the receipt is above the order — approve
 * the price exception on the bill, then Resume), WAITING_APPROVAL (the bill waits for an
 * approver, then Resume). A re-tap sends only `{ storeDocumentId }`: the server resumes from the
 * first unfinished step and never makes a second bill.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  Input,
  MoneyInput,
  Notice,
  RadioGroup,
  Select,
  Skeleton,
  Textarea,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
} from '@erp/ui';
import { ArrowRight, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Expand } from 'lucide-react';

import { useModuleTrail } from '@/components/layout/module-chrome';
import { accountName } from '@/features/accounting/account-display';
import { useAccounts, usePostingProfiles } from '@/features/accounting/hooks/use-accounting';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, parseMinorUnits } from '@/lib/money';

import { expenseProfiles } from '../../bill-actions';
import { useCanPay, useRecordStoreDocument, useRejectStoreDocument } from '../../hooks/use-quotation-payment';
import { useQuotationRequest } from '../../hooks/use-quotations';
import {
  amountProblem,
  cashHolderName,
  findPaymentAction,
  paymentActionEnabled,
  photoIdOf,
  toMoneyString,
  todayInMogadishu,
  topUpBillId,
} from '../../quotations/payment-rules';
import type {
  QuotationPayment,
  RecordStoreDocumentResult,
  StoreDocumentRejectReason,
  StoreDocumentSummary,
} from '../../quotations/payment-types';
import type { QuotationRequestDetail, QuotePhoto } from '../../quotations/types';
import { PayDialogs, type PaymentDialog } from './payment-dialogs';
import { StoreDocumentStatusPill, usePaymentRefusalText } from './payment-shared';
import { PhotoViewer } from './photo-viewer';
import { PhotosHidden, QuotePhotoImage } from './quote-shared';

const PROFILE_KEY = 'quote-receipt-expense-profile';
const REJECT_REASONS: StoreDocumentRejectReason[] = ['ILLEGIBLE', 'WRONG_PO', 'DUPLICATE', 'OTHER'];

function rememberedProfile(): string {
  try {
    return globalThis.localStorage?.getItem(PROFILE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberProfile(code: string) {
  try {
    globalThis.localStorage?.setItem(PROFILE_KEY, code);
  } catch {
    // private mode: the default is the first profile next time
  }
}

export function RecordReceiptScreen({ requestId, documentId }: { requestId: string; documentId: string }) {
  const t = useTranslations('procurement.quotes.payment.record');
  const tq = useTranslations('procurement.quotes');
  const detail = useQuotationRequest(requestId);
  useModuleTrail(detail.data?.number);

  if (detail.isPending) {
    return (
      <div role="status" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="aspect-[3/4] w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-4">
        <Alert
          variant="error"
          messages={[
            detail.error instanceof ApiError && (detail.error.status === 403 || detail.error.status === 404)
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
  const payment = detail.data.payment ?? null;
  const doc = payment?.storeDocuments.find((d) => d.id === documentId) ?? null;
  if (!payment || !doc) {
    return (
      <div className="space-y-4">
        <BackLink requestId={requestId} />
        <Notice tone="attention">{t('notFound')}</Notice>
      </div>
    );
  }
  return <RecordBody detail={detail.data} payment={payment} doc={doc} />;
}

function BackLink({ requestId }: { requestId: string }) {
  const t = useTranslations('procurement.quotes.payment.record');
  return (
    <Link
      href={`/finance/quotes/${requestId}`}
      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {t('back')}
    </Link>
  );
}

function RecordBody({
  detail,
  payment,
  doc,
}: {
  detail: QuotationRequestDetail;
  payment: QuotationPayment;
  doc: StoreDocumentSummary;
}) {
  const t = useTranslations('procurement.quotes.payment.record');
  const tDocs = useTranslations('procurement.quotes.payment.documents');
  const tReceiving = useTranslations('procurement.quotes.payment.receiving');
  const tActions = useTranslations('procurement.quotes.payment.actions');
  const locale = useLocale() as 'en';
  const canPay = useCanPay();
  const { fromError, fromCode } = usePaymentRefusalText();
  const record = useRecordStoreDocument(detail.id);
  const profiles = usePostingProfiles();
  const accounts = useAccounts();

  const currency = detail.currencyCode ?? 'USD';
  const money = (value: string | null | undefined) => formatMoney(value ?? null, currency, locale) ?? '';
  const cash = payment.path === 'BUYER_CASH';
  const holder = cashHolderName(payment);
  const holderFirst = holder ? holder.trim().split(/\s+/)[0]! : null;

  const [total, setTotal] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [documentDate, setDate] = useState(() => todayInMogadishu(new Date(doc.createdAt)));
  const options = expenseProfiles(profiles.data ?? [], accounts.data ?? [], documentDate || null);
  const [profileChoice, setProfile] = useState(rememberedProfile);
  const profileCode = options.some((o) => o.code === profileChoice) ? profileChoice : (options[0]?.code ?? '');
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<RecordStoreDocumentResult | null>(null);
  const [dialog, setDialog] = useState<PaymentDialog>(null);
  const [rejecting, setRejecting] = useState(false);
  const [topUpGated, setTopUpGated] = useState(false);

  const action = findPaymentAction(payment, 'RECORD_RECEIPT');
  const goodsIn = payment.receivingStatus === 'RECEIVED';
  // Started before (a bill exists) but not finished: only Resume makes sense.
  const inProgress = doc.status === 'SUBMITTED' && Boolean(doc.supplierBillId);
  const problem = amountProblem(total, null);
  const totalText = toMoneyString(total);
  const blockedReason = action && !action.enabled ? (fromCode(action.reason) ?? action.reason ?? null) : null;
  const done = result?.step === 'DONE' || doc.status === 'RECORDED';

  const submit = () => {
    setTouched(true);
    if (problem || !totalText || !profileCode || !documentDate) return;
    rememberProfile(profileCode);
    record.mutate(
      {
        storeDocumentId: doc.id,
        total: totalText,
        documentDate,
        expenseProfileCode: profileCode,
        ...(receiptNo.trim() ? { supplierInvoiceNumber: receiptNo.trim() } : {}),
      },
      { onSuccess: setResult },
    );
  };
  const resume = () => record.mutate({ storeDocumentId: doc.id }, { onSuccess: setResult });

  const photos = doc.photos ?? [];
  const billId = result?.bill?.id ?? doc.supplierBillId ?? null;
  const billNumber = result?.bill?.billNumber ?? result?.bill?.number ?? doc.billNumber ?? null;

  return (
    <div className="space-y-4 pb-8">
      <BackLink requestId={detail.id} />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-body font-semibold text-foreground">
          {t('title', { number: doc.number, kind: tDocs(`kind.${doc.kind}`) })}
          <span className="block text-body-sm font-normal text-muted-foreground">
            {[detail.award?.supplier?.name, payment.purchaseOrder?.poNumber, doc.uploadedByName].filter(Boolean).join(' · ')}
          </span>
        </h1>
        <StoreDocumentStatusPill status={done ? 'RECORDED' : doc.status} />
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <ReceiptPhotos doc={doc} store={detail.award?.supplier?.name ?? doc.number} photos={photos} />

        <div className="space-y-4 rounded-panel border border-border bg-surface p-4 shadow-e1">
          {/* ── Result of the last tap ───────────────────────────────────────── */}
          {done ? (
            <Notice tone="success" title={t('done.title')}>
              <p className="mt-1">
                {cash && result?.applied
                  ? t('done.cash', { amount: money(result.applied), name: holderFirst ?? t('done.theBuyer') })
                  : result?.applied
                    ? t('done.supplier', { amount: money(result.applied) })
                    : t('done.recorded')}
                {cash && (parseMinorUnits(payment.withBuyer, MONEY_SCALE) ?? 0) > 0
                  ? ` · ${t('done.stillWith', { amount: money(payment.withBuyer), name: holderFirst ?? t('done.theBuyer') })}`
                  : ''}
              </p>
              {billId ? (
                <Link
                  href={`/finance/accounting/bills/${billId}`}
                  className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-brand-primary underline underline-offset-4"
                >
                  {t('openBill', { number: billNumber ?? t('theBill') })}
                </Link>
              ) : null}
            </Notice>
          ) : null}
          {result?.step === 'MATCH_EXCEPTION' ? (
            <Notice tone="attention" title={t('exception.title')}>
              <p className="mt-1">{t('exception.body', { bill: billNumber ?? t('theBill') })}</p>
              {billId ? (
                <Link
                  href={`/finance/accounting/bills/${billId}`}
                  className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-brand-primary underline underline-offset-4"
                >
                  {t('exception.open', { bill: billNumber ?? t('theBill') })}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ) : null}
            </Notice>
          ) : null}
          {result?.step === 'WAITING_APPROVAL' ? (
            <Notice tone="info" title={t('waitingApproval.title')}>
              <p className="mt-1">{t('waitingApproval.body', { bill: billNumber ?? t('theBill') })}</p>
            </Notice>
          ) : null}
          {record.error ? <Alert variant="error" messages={[fromError(record.error) ?? '']} /> : null}
          {topUpGated ? (
            <Notice tone="info" title={t('topUpGated.title')}>
              <p className="mt-1">{t('topUpGated.body')}</p>
            </Notice>
          ) : null}

          {/* ── Facts ─────────────────────────────────────────────────────────── */}
          <ul className="space-y-1.5 text-body-sm">
            {payment.moneyVisible ? (
              <li className="text-foreground">
                {t('poTotal', { amount: money(payment.orderedAmount) })}
              </li>
            ) : null}
            <li className="flex items-center gap-2">
              {goodsIn ? (
                <CircleCheck className="size-4 text-success" aria-hidden="true" />
              ) : (
                <CircleDashed className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              {t('goods', { status: tReceiving(payment.receivingStatus) })}
            </li>
            <li className="text-muted-foreground">
              {cash ? t('paidFromCash', { name: holderFirst ?? t('done.theBuyer') }) : t('paidBySupplierPayment')}
            </li>
          </ul>

          {/* ── The form, or Resume ───────────────────────────────────────────── */}
          {!done && canPay && (inProgress || result?.step === 'MATCH_EXCEPTION' || result?.step === 'WAITING_APPROVAL') ? (
            <Button type="button" size="lg" className="h-14 w-full text-base" loading={record.isPending} onClick={resume}>
              {t('resume')}
            </Button>
          ) : null}

          {!done && canPay && !inProgress && !result ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <FormField
                htmlFor="record-total"
                label={t('total')}
                hint={t('totalHint')}
                error={touched && problem ? t(problem === 'zero' ? 'totalZero' : 'totalEmpty') : undefined}
              >
                <MoneyInput id="record-total" value={total} onValueChange={setTotal} className="h-12 text-lg" />
              </FormField>
              <FormField htmlFor="record-number" label={t('receiptNo')} hint={t('receiptNoHint', { number: doc.number })}>
                <Input id="record-number" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} autoComplete="off" />
              </FormField>
              <FormField htmlFor="record-date" label={t('date')}>
                <DatePicker id="record-date" value={documentDate} onChange={setDate} />
              </FormField>
              <FormField
                htmlFor="record-expense"
                label={t('expense')}
                error={
                  !profiles.isPending && !accounts.isPending && options.length === 0 ? t('noExpenseProfiles') : undefined
                }
              >
                <Select id="record-expense" value={profileCode} onChange={setProfile} disabled={options.length === 0}>
                  {options.map((profile) => (
                    <option key={profile.code} value={profile.code}>
                      {profile.name} · {profile.account.code} {accountName(profile.account, locale)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button
                type="submit"
                size="lg"
                className="h-14 w-full text-base"
                disabled={Boolean(blockedReason) || !goodsIn || options.length === 0}
                aria-describedby={blockedReason || !goodsIn ? 'record-blocked' : undefined}
                loading={record.isPending}
              >
                {t('submit')}
              </Button>
              {blockedReason || !goodsIn ? (
                <p id="record-blocked" className="text-center text-body-sm text-muted-foreground">
                  {blockedReason ?? fromCode('GOODS_NOT_RECEIVED')}
                </p>
              ) : null}
            </form>
          ) : null}

          {/* ── After: change returned / top up ─────────────────────────────────── */}
          {canPay && done ? (
            <div className="flex flex-wrap gap-2">
              {paymentActionEnabled(payment, 'RECORD_RETURN') ? (
                <Button type="button" className="min-h-11" onClick={() => setDialog('return')}>
                  {tActions('RECORD_RETURN')}
                </Button>
              ) : null}
              {paymentActionEnabled(payment, 'TOP_UP') ? (
                <Button type="button" variant="outline" className="min-h-11" onClick={() => setDialog('topUp')}>
                  {tActions('TOP_UP')}
                </Button>
              ) : null}
              <Button asChild variant="ghost" className="min-h-11">
                <Link href={`/finance/quotes/${detail.id}`}>{t('backToRequest')}</Link>
              </Button>
            </div>
          ) : null}

          {canPay && doc.status === 'SUBMITTED' && !inProgress && !result ? (
            <Button type="button" variant="ghost" className="min-h-11 w-full text-muted-foreground" onClick={() => setRejecting(true)}>
              {tDocs('reject')}
            </Button>
          ) : null}
        </div>
      </div>

      <PayDialogs
        open={dialog}
        detail={detail}
        payment={payment}
        storeName={detail.award?.supplier?.name ?? '—'}
        topUpBillId={billId ?? topUpBillId(payment)}
        onClose={() => setDialog(null)}
        onGated={() => setTopUpGated(true)}
        onAwaitingSignatures={() => undefined}
      />
      {rejecting ? <RejectDialog requestId={detail.id} doc={doc} onClose={() => setRejecting(false)} /> : null}
    </div>
  );
}

function ReceiptPhotos({ doc, store, photos }: { doc: StoreDocumentSummary; store: string; photos: StoreDocumentSummary['photos'] }) {
  const t = useTranslations('procurement.quotes.payment.record');
  const tDocs = useTranslations('procurement.quotes.payment.documents');
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(false);
  const list = (photos ?? []).map((p, i) => ({ ...p, id: photoIdOf(p), index: i })).filter((p) => p.id);
  if (list.length === 0) {
    return <PhotosHidden count={doc.photoCount ?? 0} className="aspect-[3/4] w-full" />;
  }
  const current = list[Math.min(page, list.length - 1)]!;
  const viewerPhotos: QuotePhoto[] = list.map((p, i) => ({
    fileId: p.id!,
    pageNumber: p.pageNumber ?? i + 1,
    capturedAt: p.capturedAt ?? null,
    source: 'UNKNOWN',
    sha256: '',
    reusedOn: [],
  }));
  const kind = tDocs(`kind.${doc.kind}`);
  return (
    <figure className="space-y-2">
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="relative block w-full overflow-hidden rounded-panel border border-border bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        aria-label={t('zoom', { kind, page: page + 1 })}
      >
        <QuotePhotoImage
          fileId={current.id!}
          alt={t('photoAlt', { kind, page: page + 1 })}
          fit="contain"
          className="aspect-[3/4] max-h-[75vh] w-full"
        />
        <Expand className="absolute end-2 top-2 size-5 rounded bg-background/80 p-0.5 text-foreground" aria-hidden="true" />
      </button>
      {list.length > 1 ? (
        <figcaption className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 min-h-11 w-11 min-w-11"
            aria-label={t('previousPage')}
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <span className="text-body-sm tabular-nums text-muted-foreground">
            {t('pageOf', { page: page + 1, count: list.length })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 min-h-11 w-11 min-w-11"
            aria-label={t('nextPage')}
            disabled={page >= list.length - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        </figcaption>
      ) : null}
      {zoom ? <PhotoViewer store={store} photos={viewerPhotos} initialPage={page} onClose={() => setZoom(false)} /> : null}
    </figure>
  );
}

function RejectDialog({ requestId, doc, onClose }: { requestId: string; doc: StoreDocumentSummary; onClose: () => void }) {
  const t = useTranslations('procurement.quotes.payment.documents');
  const tCommon = useTranslations('common');
  const { fromError } = usePaymentRefusalText();
  const reject = useRejectStoreDocument(requestId);
  const [reason, setReason] = useState<StoreDocumentRejectReason>('ILLEGIBLE');
  const [note, setNote] = useState('');
  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('rejectTitle', { number: doc.number })}
      subtitle={t('rejectBody')}
      closeLabel={tCommon('close')}
      busy={reject.isPending}
      onSubmit={() =>
        reject.mutate({ id: doc.id, reason, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onClose })
      }
    >
      <FormDialogBody className="space-y-4">
        <RadioGroup
          label={t('rejectReasonLabel')}
          name="reject-reason"
          value={reason}
          orientation="vertical"
          onChange={setReason}
          options={REJECT_REASONS.map((value) => ({ value, label: t(`rejectReason.${value}`) }))}
        />
        <FormField htmlFor="reject-note" label={t('rejectNoteLabel')}>
          <Textarea id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </FormField>
        {reject.error ? <Alert variant="error" messages={[fromError(reject.error) ?? '']} /> : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" className="min-h-11" loading={reject.isPending}>
          {t('rejectConfirm')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
