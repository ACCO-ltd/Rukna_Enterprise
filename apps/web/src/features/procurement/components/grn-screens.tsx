'use client';

/**
 * Goods receipts (§12.7) — list, create and detail.
 *
 * Routed at `/procurement/grn`, not `/procurement/receipts`. §12.7 offers both and warns
 * about the clash with Sprint 3's client payment receipts at `/receipts`; `grn` cannot be
 * misread by someone scanning the sidebar for where a customer payment went.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/format';
import { QUANTITY_SCALE, parseMinorUnits } from '@/lib/money';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import {
  useApproveGoodsReceiptException,
  useCancelGoodsReceipt,
  useCreateGoodsReceipt,
  useGoodsReceipt,
  useGoodsReceipts,
  usePostGoodsReceipt,
  usePurchaseOrders,
} from '../hooks/use-procurement';
import { activeRevision, quantityToApi } from '../quantities';
import type { CreateGrnLinePayload, GoodsReceipt } from '../types';
import {
  GrnLineEditor,
  grnLineError,
  grnLineQuantities,
  grnLinesFromPo,
  submittableGrnLines,
  type GrnLineDraft,
} from './grn-line-editor';
import { ClassificationChips } from './classification-chips';
import { ProcurementStatusBadge } from './procurement-badges';
import { QuantitySplit } from './material-picker';

// ─── List ────────────────────────────────────────────────────────────────────────

export function GrnList() {
  const t = useTranslations('procurement.grn');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const receipts = useGoodsReceipts();
  const orders = usePurchaseOrders();

  const poNumber = (id: string) =>
    orders.data?.find((po) => po.id === id)?.poNumber ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {can(PROCUREMENT_PERMISSIONS.createReceipt) ? (
          <Button asChild>
            <Link href="/procurement/grn/new">{t('new')}</Link>
          </Button>
        ) : null}
      </div>

      {receipts.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('number')}</TableHead>
              <TableHead>{t('purchaseOrder')}</TableHead>
              <TableHead>{t('deliveryDate')}</TableHead>
              <TableHead>{t('deliveryNoteRef')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(receipts.data ?? []).length === 0 ? (
              <TableEmpty colSpan={5}>{t('empty')}</TableEmpty>
            ) : (
              (receipts.data ?? []).map((grn) => (
                <TableRow key={grn.id}>
                  <TableCell>
                    <Link
                      href={`/procurement/grn/${grn.id}`}
                      className="font-mono text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
                    >
                      {grn.grnNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {grn.purchaseOrder?.poNumber ?? poNumber(grn.purchaseOrderId) ?? tc('notAvailable')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <bdi>{formatDate(grn.deliveryDate, locale) ?? tc('notAvailable')}</bdi>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {grn.deliveryNoteRef ?? tc('notAvailable')}
                  </TableCell>
                  <TableCell>
                    <ProcurementStatusBadge status={grn.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </div>
  );
}

// ─── Receive (create + post in one action) ─────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record a delivery against a PO. Round 2, single-screen, acceptance-by-default (D5).
 *
 * The two-step Sprint-5 wizard is collapsed: pick a PO in the header and the line table
 * pre-fills one stacked block per open PO line, each accepted whole by default. Delivery
 * date and an optional note ref sit in the header; a sticky footer holds the single
 * primary action, **Receive**.
 *
 * ─── Receive = record + post in one action (D5) ─────────────────────────────────────
 *
 * "Receive" orchestrates the existing endpoints:
 *   create the GRN → if it comes back DRAFT (clean), post it (DRAFT→POSTED) → done.
 *   If it comes back EXCEPTION_PENDING, the over-receipt exceeded the org tolerance (A1),
 *   so we do NOT force a post: the receipt is recorded and held, and we route to its detail
 *   where the honest exception state and the gated `approve-exception` action live.
 *
 * The ceremonial standalone Post step is gone from the normal path — a clean delivery is
 * received and posted as one action. Post survives only as the second half of this
 * orchestration and as the follow-up once a held receipt's exception is cleared.
 */
export function GrnForm() {
  const t = useTranslations('procurement.grn');
  const tc = useTranslations('procurement.common');
  const router = useRouter();

  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [deliveryNoteRef, setDeliveryNoteRef] = useState('');
  const [lines, setLines] = useState<GrnLineDraft[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  // A create that already succeeded must not run again if the follow-up post fails and the
  // user retries — that would raise a duplicate GRN for the same delivery.
  const createdIdRef = useRef<string | null>(null);

  const orders = usePurchaseOrders({ status: 'OPEN' });
  const create = useCreateGoodsReceipt();
  const post = usePostGoodsReceipt();

  /** Only an OPEN order with an ACTIVE revision can be received against (§6.30). */
  const receivable = useMemo(
    () => (orders.data ?? []).filter((po) => activeRevision(po.revisions) !== null),
    [orders.data],
  );

  const selectPo = (id: string) => {
    setPurchaseOrderId(id);
    const po = receivable.find((p) => p.id === id);
    const revision = po ? activeRevision(po.revisions) : null;
    setLines(revision?.lines ? grnLinesFromPo(revision.lines) : []);
    setShowErrors(false);
    setReceiveError(null);
    createdIdRef.current = null;
  };

  const submittable = submittableGrnLines(lines);
  const hasLineError = lines.some((l) => grnLineError(l) !== null);

  function buildLines(): CreateGrnLinePayload[] {
    // Untouched rows are omitted, not sent as zeros — @IsPositive() would reject the whole
    // request over a line nobody delivered against (P6).
    return submittable.map((line): CreateGrnLinePayload => {
      const q = grnLineQuantities(line);
      return {
        purchaseOrderLineId: line.purchaseOrderLineId,
        receivedQuantity: quantityToApi(q.receivedMinor),
        acceptedQuantity: quantityToApi(q.acceptedMinor),
        ...(q.rejectedMinor > 0 ? { rejectedQuantity: quantityToApi(q.rejectedMinor) } : {}),
        ...(line.mode === 'discrepancy' && line.rejectionReason.trim()
          ? { rejectionReason: line.rejectionReason.trim() }
          : {}),
        ...(line.mode === 'discrepancy' && line.notes.trim()
          ? { notes: line.notes.trim() }
          : {}),
        // Acceptance-by-default: a clean line is ACCEPTED whole (D5); a discrepancy line
        // carries whatever quality the user chose.
        qualityStatus: line.mode === 'clean' ? 'ACCEPTED' : line.qualityStatus,
      };
    });
  }

  const runReceive = useCallback(async () => {
    setReceiveError(null);
    setBusy(true);
    try {
      let grn: GoodsReceipt;
      if (createdIdRef.current) {
        // The create already succeeded on a prior attempt; only the post is left to retry.
        grn = { id: createdIdRef.current, status: 'DRAFT' } as GoodsReceipt;
      } else {
        grn = await create.mutateAsync({
          purchaseOrderId,
          deliveryDate,
          ...(deliveryNoteRef.trim() ? { deliveryNoteRef: deliveryNoteRef.trim() } : {}),
          lines: buildLines(),
        });
        createdIdRef.current = grn.id;
      }

      // The server routed an out-of-tolerance over-receipt to EXCEPTION_PENDING (A1). It is
      // recorded and held — do not force a post. Show the honest state on its detail page.
      if (grn.status === 'EXCEPTION_PENDING') {
        router.push(`/procurement/grn/${grn.id}`);
        return;
      }

      // Clean receipt: post it (DRAFT → POSTED) so record + post is one action (D5).
      await post.mutateAsync({ id: grn.id });
      router.push(`/procurement/grn/${grn.id}`);
    } catch (e) {
      setReceiveError(e instanceof ApiError ? e.message : tc('loadFailed'));
    } finally {
      setBusy(false);
    }
    // buildLines reads current state; it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create, post, router, purchaseOrderId, deliveryDate, deliveryNoteRef]);

  function handleReceive() {
    setShowErrors(true);
    if (hasLineError || submittable.length === 0 || !purchaseOrderId) return;
    void runReceive();
  }

  const canReceive = purchaseOrderId !== '' && lines.length > 0;

  return (
    <div className="space-y-6 pb-28">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('createTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('createSubtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="grn-po" label={t('purchaseOrder')}>
          <Select id="grn-po" value={purchaseOrderId} onChange={(e) => selectPo(e.target.value)}>
            <option value="">{t('selectPo')}</option>
            {receivable.map((po) => (
              <option key={po.id} value={po.id}>
                {po.poNumber} · {po.supplier?.name ?? tc('notAvailable')}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{t('selectPoHint')}</p>
        </FormField>

        <FormField htmlFor="grn-date" label={t('deliveryDate')}>
          <Input
            id="grn-date"
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </FormField>

        <FormField
          htmlFor="grn-note"
          label={`${t('deliveryNoteRef')} (${tc('optional')})`}
        >
          <Input
            id="grn-note"
            value={deliveryNoteRef}
            onChange={(e) => setDeliveryNoteRef(e.target.value)}
          />
        </FormField>
      </div>

      {receivable.length === 0 && !orders.isPending ? (
        <Alert variant="info" messages={[t('noReceivablePo')]} />
      ) : null}

      {orders.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

      {lines.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('linesTitle')}
          </h2>
          <GrnLineEditor lines={lines} onChange={setLines} showErrors={showErrors} />
        </section>
      ) : null}

      {showErrors && submittable.length === 0 && lines.length > 0 ? (
        <Alert variant="error" messages={[t('allLinesEmpty')]} />
      ) : null}

      {receiveError ? <Alert variant="error" messages={[receiveError]} /> : null}

      {/* ── Sticky footer: the single primary action ──────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" disabled={busy} onClick={() => router.back()}>
            {tc('cancel')}
          </Button>
          <Button type="button" disabled={busy || !canReceive} onClick={handleReceive}>
            {t('receive')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

export function GrnDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.grn');
  const tc = useTranslations('procurement.common');
  const tQuality = useTranslations('procurement.grn.quality');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const grn = useGoodsReceipt(id);
  const [posting, setPosting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [approvingException, setApprovingException] = useState(false);
  const cancel = useCancelGoodsReceipt();
  const post = usePostGoodsReceipt();
  const approveException = useApproveGoodsReceiptException();

  if (grn.isPending) {
    return (
      <div role="status" aria-live="polite">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (grn.isError || !grn.data) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const receipt: GoodsReceipt = grn.data;
  const q = (v: string) => parseMinorUnits(v, QUANTITY_SCALE) ?? 0;
  const canApproveException = can(PROCUREMENT_PERMISSIONS.approveReceiptException);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {receipt.grnNumber}
          </h1>
          <div className="mt-2">
            <ProcurementStatusBadge status={receipt.status} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* A DRAFT reaching this page has had its over-receipt exception cleared — a clean
              delivery is received and posted in one action and never lands here as DRAFT.
              Post is the completion of that held-then-cleared flow, not a ceremonial step. */}
          {receipt.status === 'DRAFT' ? (
            <>
              <Button type="button" onClick={() => setPosting(true)}>
                {t('post')}
              </Button>
              <Button type="button" variant="destructive" onClick={() => setCancelling(true)}>
                {t('cancelReceipt')}
              </Button>
            </>
          ) : null}

          {/* EXCEPTION_PENDING: a supervisor with the permission clears the over-receipt hold
              (→ DRAFT, then Post). Without it, cancelling is the only move. */}
          {receipt.status === 'EXCEPTION_PENDING' ? (
            <>
              {canApproveException ? (
                <Button type="button" onClick={() => setApprovingException(true)}>
                  {t('approveException')}
                </Button>
              ) : null}
              <Button type="button" variant="destructive" onClick={() => setCancelling(true)}>
                {t('cancelReceipt')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {receipt.status === 'EXCEPTION_PENDING' ? (
        <Alert
          variant="warning"
          title={t('exceptionTitle')}
          messages={
            canApproveException
              ? [t('exceptionBody'), t('exceptionApprovable')]
              : [t('exceptionBody'), t('exceptionNoPermission')]
          }
        />
      ) : null}

      {receipt.status === 'POSTED' ? (
        <Alert variant="info" messages={[t('postedNotice')]} />
      ) : null}

      <dl className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label={t('deliveryDate')}
          value={formatDate(receipt.deliveryDate, locale) ?? tc('notAvailable')}
        />
        <Field label={t('deliveryNoteRef')} value={receipt.deliveryNoteRef ?? tc('notAvailable')} />
        <Field
          label={t('purchaseOrder')}
          value={receipt.purchaseOrder?.poNumber ?? tc('notAvailable')}
        />
        <Field
          label={t('post')}
          value={formatDate(receipt.postedAt, locale) ?? tc('notAvailable')}
        />
      </dl>

      <TableScroll aria-label={t('linesTitle')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-end">{tc('lineNumber')}</TableHead>
              <TableHead>{tc('description')}</TableHead>
              <TableHead className="text-end">{t('orderedQuantity')}</TableHead>
              <TableHead className="text-end">{t('previouslyReceived')}</TableHead>
              <TableHead>{tc('quantity')}</TableHead>
              <TableHead>{t('qualityStatus')}</TableHead>
              <TableHead>{t('rejectionReason')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipt.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="text-end tabular-nums">{line.lineNumber}</TableCell>
                <TableCell className="text-sm">
                  {line.material?.code ? (
                    <span className="me-2 font-mono text-xs text-muted-foreground">
                      {line.material.code}
                    </span>
                  ) : null}
                  {line.material?.name ?? ''}
                  {/* Read-only classification chip (D7). A GR line inherits its type from the
                      PO line and carries no spend category or BOQ node, so only the type
                      chip renders. */}
                  <ClassificationChips className="mt-1.5 flex flex-wrap items-center gap-1.5" lineType={line.lineType} />
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(line.orderedQuantity, locale)}
                </TableCell>
                <TableCell className="text-end tabular-nums text-muted-foreground">
                  {formatNumber(line.previouslyReceivedQty, locale)}
                </TableCell>
                <TableCell>
                  <QuantitySplit
                    receivedMinor={q(line.receivedQuantity)}
                    acceptedMinor={q(line.acceptedQuantity)}
                    rejectedMinor={q(line.rejectedQuantity)}
                  />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {tQuality(line.qualityStatus)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {line.rejectionReason ?? tc('notAvailable')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>

      {posting ? (
        <ConfirmActionDialog
          title={t('postTitle', { number: receipt.grnNumber })}
          description={t('postBody')}
          confirmLabel={t('post')}
          isPending={post.isPending}
          errorMessage={post.isError ? tc('loadFailed') : undefined}
          onConfirm={() => post.mutate({ id: receipt.id }, { onSuccess: () => setPosting(false) })}
          onDismiss={() => setPosting(false)}
        />
      ) : null}

      {approvingException ? (
        <ConfirmActionDialog
          title={t('approveExceptionTitle', { number: receipt.grnNumber })}
          description={t('approveExceptionBody')}
          confirmLabel={t('approveException')}
          isPending={approveException.isPending}
          errorMessage={approveException.isError ? tc('loadFailed') : undefined}
          onConfirm={() =>
            approveException.mutate(receipt.id, { onSuccess: () => setApprovingException(false) })
          }
          onDismiss={() => setApprovingException(false)}
        />
      ) : null}

      {cancelling ? (
        <ConfirmActionDialog
          title={t('cancelTitle', { number: receipt.grnNumber })}
          description={t('cancelBody')}
          confirmLabel={t('cancelReceipt')}
          isPending={cancel.isPending}
          errorMessage={cancel.isError ? tc('loadFailed') : undefined}
          onConfirm={() => cancel.mutate(receipt.id, { onSuccess: () => setCancelling(false) })}
          onDismiss={() => setCancelling(false)}
        />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
