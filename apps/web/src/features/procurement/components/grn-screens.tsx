'use client';

/**
 * Goods receipts (§12.7) — list, create and detail.
 *
 * Routed at `/procurement/grn`, not `/procurement/receipts`. §12.7 offers both and warns
 * about the clash with Sprint 3's client payment receipts at `/receipts`; `grn` cannot be
 * misread by someone scanning the sidebar for where a customer payment went.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
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

// ─── Create ──────────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function GrnForm() {
  const t = useTranslations('procurement.grn');
  const tc = useTranslations('procurement.common');
  const router = useRouter();

  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [deliveryNoteRef, setDeliveryNoteRef] = useState('');
  const [lines, setLines] = useState<GrnLineDraft[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  const orders = usePurchaseOrders({ status: 'OPEN' });
  const create = useCreateGoodsReceipt();

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
  };

  const submittable = submittableGrnLines(lines);
  const hasLineError = lines.some((l) => grnLineError(l) !== null);

  function handleSubmit() {
    setShowErrors(true);
    if (hasLineError || submittable.length === 0 || !purchaseOrderId) return;

    create.mutate(
      {
        purchaseOrderId,
        deliveryDate,
        ...(deliveryNoteRef.trim() ? { deliveryNoteRef: deliveryNoteRef.trim() } : {}),
        // Untouched rows are omitted, not sent as zeros — @IsPositive() would reject the
        // whole request over a line nobody delivered against (P6).
        lines: submittable.map((line): CreateGrnLinePayload => {
          const q = grnLineQuantities(line);
          return {
            purchaseOrderLineId: line.purchaseOrderLineId,
            receivedQuantity: quantityToApi(q.receivedMinor),
            acceptedQuantity: quantityToApi(q.acceptedMinor),
            ...(q.rejectedMinor > 0
              ? { rejectedQuantity: quantityToApi(q.rejectedMinor) }
              : {}),
            ...(line.rejectionReason.trim()
              ? { rejectionReason: line.rejectionReason.trim() }
              : {}),
            qualityStatus: line.qualityStatus,
          };
        }),
      },
      { onSuccess: (grn) => router.push(`/procurement/grn/${grn.id}`) },
    );
  }

  const serverError =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? tc('loadFailed')
        : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t('createTitle')}
      </h1>

      <div className="max-w-xl space-y-4">
        <FormField htmlFor="grn-po" label={t('purchaseOrder')}>
          <select
            id="grn-po"
            value={purchaseOrderId}
            onChange={(e) => selectPo(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="">{t('selectPo')}</option>
            {receivable.map((po) => (
              <option key={po.id} value={po.id}>
                {po.poNumber} · {po.supplier?.name ?? tc('notAvailable')}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t('selectPoHint')}</p>
        </FormField>

        {receivable.length === 0 && !orders.isPending ? (
          <Alert variant="info" messages={[t('noReceivablePo')]} />
        ) : null}

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

      {lines.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t('linesTitle')}</h2>
          <GrnLineEditor lines={lines} onChange={setLines} showErrors={showErrors} />
        </section>
      ) : null}

      {showErrors && submittable.length === 0 && lines.length > 0 ? (
        <Alert variant="error" messages={[t('allLinesEmpty')]} />
      ) : null}

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tc('cancel')}
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={create.isPending || lines.length === 0}
        >
          {tc('create')}
        </Button>
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

  const grn = useGoodsReceipt(id);
  const [posting, setPosting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancel = useCancelGoodsReceipt();

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

          {/* EXCEPTION_PENDING can only be cancelled. Nothing returns it to DRAFT and PO
              revision does not re-evaluate it (P10), so Post is not offered at all. */}
          {receipt.status === 'EXCEPTION_PENDING' ? (
            <Button type="button" variant="destructive" onClick={() => setCancelling(true)}>
              {t('cancelReceipt')}
            </Button>
          ) : null}
        </div>
      </div>

      {receipt.status === 'EXCEPTION_PENDING' ? (
        <Alert
          variant="warning"
          title={t('exceptionTitle')}
          messages={[t('exceptionBody'), t('exceptionDeadEnd')]}
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

      {posting ? <PostDrawer receipt={receipt} onClose={() => setPosting(false)} /> : null}

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

function PostDrawer({ receipt, onClose }: { receipt: GoodsReceipt; onClose: () => void }) {
  const t = useTranslations('procurement.grn');
  const tc = useTranslations('procurement.common');
  const post = usePostGoodsReceipt();

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent className="p-6">
        <SheetTitle className="text-lg font-semibold text-foreground">
          {t('postTitle', { number: receipt.grnNumber })}
        </SheetTitle>

        <div className="mt-5 space-y-4">
          <Alert variant="info" messages={[t('postBody')]} />

          {post.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={post.isPending}>
              {tc('cancel')}
            </Button>
            <Button
              type="button"
              disabled={post.isPending}
              onClick={() =>
                post.mutate({ id: receipt.id }, { onSuccess: onClose })
              }
            >
              {t('post')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
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
