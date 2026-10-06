'use client';

/**
 * Goods receipts (§12.7) — list, create and detail.
 *
 * Routed at `/procurement/grn`, not `/procurement/receipts`. §12.7 offers both and warns
 * about the clash with Sprint 3's client payment receipts at `/receipts`; `grn` cannot be
 * misread by someone scanning the sidebar for where a customer payment went.
 */

import { useCallback, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Combobox,
  DatePicker,
  EmptyState,
  FormActionBar,
  FormField,
  Input,
  Notice,
  SkeletonRecord,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  type FilterValues,
  type ListFilterField,
} from '@erp/ui';
import { ChevronLeft, Plus } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import {
  useApproveGoodsReceiptException,
  useCancelGoodsReceipt,
  useCreateGoodsReceipt,
  useCreateReceiptException,
  useGoodsReceipt,
  useGoodsReceipts,
  usePostGoodsReceipt,
  usePurchaseOrder,
  useReceivablePurchaseOrders,
} from '../hooks/use-procurement';
import { activeRevision } from '../quantities';
import type { GoodsReceipt, GoodsReceiptStatus } from '../types';
import {
  GrnLineEditor,
  acceptedValueMinor,
  anyOverStillDue,
  grnLineControlId,
  grnLineErrors,
  grnLinesFromReceivable,
  submittableGrnLines,
  toGrnLinePayload,
  type GrnLineDraft,
} from './grn-line-editor';
import { ClassificationChips } from './classification-chips';
import { ListRowMenu, errorText } from './list-row-menu';
import { useListControls } from './use-list-controls';
import { ProcurementStatusBadge } from './procurement-badges';
import { QuantitySplit } from './material-picker';

// ─── List ────────────────────────────────────────────────────────────────────────

const GRN_STATUSES: GoodsReceiptStatus[] = ['DRAFT', 'EXCEPTION_PENDING', 'POSTED', 'CANCELLED'];

/**
 * Goods receipt list (shared list pattern, clients-list reference).
 *
 * Search and Status run on the server; sort and paging are local. Supplier, purchase order,
 * project and who delivered come with each row of the list read.
 */
export function GrnList() {
  const t = useTranslations('procurement.grn.list');
  const tGrn = useTranslations('procurement.grn');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const { can } = usePermissions();
  const mayReceive = can(PROCUREMENT_PERMISSIONS.createReceipt);

  const [filters, setFilters] = useState<FilterValues>({});
  const controls = useListControls();
  const receipts = useGoodsReceipts({
    ...(filters.status ? { status: filters.status as GoodsReceiptStatus } : {}),
    ...(controls.debouncedSearch ? { search: controls.debouncedSearch } : {}),
  });
  const cancel = useCancelGoodsReceipt();
  const [cancelling, setCancelling] = useState<GoodsReceipt | null>(null);

  const all = useMemo(() => receipts.data ?? [], [receipts.data]);

  const poNumberOf = (grn: GoodsReceipt): string | null =>
    grn.purchaseOrder?.number ?? grn.purchaseOrder?.poNumber ?? null;
  const supplierOf = (grn: GoodsReceipt): string | null => grn.supplier?.name ?? null;

  const dash = <span className="text-muted-foreground">{tc('notAvailable')}</span>;

  const columns: GridColumn<GoodsReceipt>[] = [
    {
      key: 'receipt',
      header: t('columns.receipt'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (grn) => `${grn.grnNumber} ${supplierOf(grn) ?? ''}`,
      // The grid wraps this cell in the row's one link.
      render: (grn) => (
        <span className="block min-w-0">
          <span className="block font-semibold text-brand-primary">{grn.grnNumber}</span>
          <span className="block max-w-[18rem] truncate text-caption font-normal text-muted-foreground">
            {supplierOf(grn) ?? tc('notAvailable')}
          </span>
        </span>
      ),
    },
    {
      key: 'purchaseOrder',
      header: t('columns.purchaseOrder'),
      sortable: true,
      card: 'subtitle',
      plainValue: (grn) => poNumberOf(grn) ?? '',
      render: (grn) => {
        const number = poNumberOf(grn);
        return number ? (
          <Link
            href={`/procurement/orders/${grn.purchaseOrderId}`}
            className="font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {number}
          </Link>
        ) : (
          dash
        );
      },
    },
    {
      key: 'project',
      header: t('columns.project'),
      sortable: true,
      plainValue: (grn) => grn.project?.name ?? '',
      render: (grn) =>
        grn.project ? (
          <span className="block min-w-0">
            <span className="block max-w-[16rem] truncate">{grn.project.name}</span>
            {grn.projectCount && grn.projectCount > 1 ? (
              <span className="block text-caption text-muted-foreground">
                {tc('moreProjects', { count: grn.projectCount - 1 })}
              </span>
            ) : null}
          </span>
        ) : (
          dash
        ),
    },
    {
      key: 'delivered',
      header: t('columns.delivered'),
      sortable: true,
      card: 'meta',
      plainValue: (grn) => grn.deliveryDate,
      render: (grn, ctx) => (
        <span className="block">
          <span className="block">{formatDate(grn.deliveryDate, ctx.locale) ?? tc('notAvailable')}</span>
          {grn.deliveredBy ? (
            <span className="block text-caption text-muted-foreground">{t('by', { name: grn.deliveredBy.name })}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'deliveryNote',
      header: t('columns.deliveryNote'),
      sortable: true,
      plainValue: (grn) => grn.deliveryNoteRef ?? '',
      render: (grn) => grn.deliveryNoteRef ?? dash,
    },
    {
      key: 'status',
      header: t('columns.status'),
      card: 'status',
      render: (grn) => <ProcurementStatusBadge vocabulary="grn" status={grn.status} />,
    },
  ];

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filters.status'),
      options: GRN_STATUSES.map((value) => ({ value, label: tStatus(value) })),
    },
  ];

  const isNarrowed = Boolean(controls.search) || Object.values(filters).some(Boolean);
  const view = controls.view(all, columns);

  const createAction = mayReceive ? (
    <Button asChild>
      <Link href="/procurement/grn/new">
        <Plus className="size-4" aria-hidden="true" />
        {t('new')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <>
      <PlatformDataGrid
        columns={columns}
        data={view.data}
        rowKey={(grn) => grn.id}
        label={tGrn('title')}
        isLoading={receipts.isPending}
        isError={receipts.isError}
        errorMessage={tc('loadFailed')}
        onRetry={() => void receipts.refetch()}
        rowHref={(grn) => `/procurement/grn/${grn.id}`}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        server={view.server}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={(next) => {
          setFilters(next);
          controls.resetPage();
        }}
        rowActions={(grn) => (
          <ListRowMenu
            label={tc('rowMenu', { number: grn.grnNumber })}
            openHref={`/procurement/grn/${grn.id}`}
            openLabel={tc('open')}
            commands={
              mayReceive && grn.status === 'DRAFT'
                ? [{ key: 'cancel', label: tGrn('cancelReceipt'), onSelect: () => setCancelling(grn) }]
                : []
            }
          />
        )}
        // First use only — a filter that empties the list gets the grid's filtered-empty state.
        emptyState={
          !isNarrowed && receipts.data !== undefined && all.length === 0 ? (
            <EmptyState title={t('empty')} description={t('emptyHint')} action={createAction} />
          ) : undefined
        }
        toolbarActions={createAction}
      />

      {cancelling ? (
        <ConfirmActionDialog
          title={tGrn('cancelTitle', { number: cancelling.grnNumber })}
          description={tGrn('cancelBody')}
          confirmLabel={tGrn('cancelReceipt')}
          destructive
          isPending={cancel.isPending}
          errorMessage={cancel.error ? errorText(cancel.error, tc('loadFailed')) : undefined}
          onConfirm={() => cancel.mutate(cancelling.id, { onSuccess: () => setCancelling(null) })}
          onDismiss={() => {
            cancel.reset();
            setCancelling(null);
          }}
        />
      ) : null}
    </>
  );
}

// ─── Receive a delivery (create + post in one action) ───────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The receipt 403 that carries the segregation-of-duties refusal. */
function isCreatorCannotReceive(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.details?.code === 'PO_CREATOR_CANNOT_RECEIVE_GOODS'
  );
}

/**
 * Receive a delivery against an open purchase order.
 *
 * Every line arrives prefilled with what is still due; the receiver changes only what is
 * different and posts. "Post receipt" confirms first (posted receipts can't be edited), then
 * creates the receipt and posts it as one action (D5):
 *
 *   create → DRAFT → post → POSTED. An over-receipt beyond tolerance is flagged
 *   (`overReceiptFlag`) and posts like any other receipt. Should a receipt ever come back
 *   EXCEPTION_PENDING (A1's hold, not produced by the server today) it is not forced through —
 *   we open its detail, where the exception lives. A create that succeeded is never repeated on a retry
 *   after the post failed (`createdIdRef`).
 *
 * Segregation of duties is the server's: the receivable list says whether this viewer may
 * receive each order (`canReceive`), and the receipt's own 403 says so if the list could not.
 * Either way the screen explains it and offers to request an exception — it never decides.
 */
export function GrnForm({ initialPoId }: { initialPoId?: string }) {
  const t = useTranslations('procurement.grn.receive');
  const tErr = useTranslations('procurement.grn.receive.errors');
  const tGrn = useTranslations('procurement.grn');
  const tc = useTranslations('procurement.common');
  const tForm = useTranslations('common.formState');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { can } = usePermissions();
  const moneyVisible = can(PROCUREMENT_PERMISSIONS.viewCommitments);
  // The module header owns the page's h1 (ADR-035); the form names itself in the breadcrumb.
  useModuleTrail(tGrn('createTitle'));

  const receivable = useReceivablePurchaseOrders();
  const [purchaseOrderId, setPurchaseOrderId] = useState(initialPoId ?? '');
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [deliveryNoteRef, setDeliveryNoteRef] = useState('');
  const [edited, setEdited] = useState<GrnLineDraft[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [refusedPoIds, setRefusedPoIds] = useState<ReadonlySet<string>>(new Set());
  const [requestingException, setRequestingException] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // A create that already succeeded must not run again if the follow-up post fails and the
  // user retries — that would raise a duplicate GRN for the same delivery.
  const createdIdRef = useRef<string | null>(null);

  const create = useCreateGoodsReceipt();
  const post = usePostGoodsReceipt();
  const requestException = useCreateReceiptException();

  const orders = useMemo(() => receivable.data ?? [], [receivable.data]);
  const selected = orders.find((po) => po.id === purchaseOrderId) ?? null;
  const blocked = selected !== null && (!selected.canReceive || refusedPoIds.has(selected.id));

  // The receivable read carries each open line but no prices. The order's own unit prices are
  // read only for someone who may see money, and only to value what is accepted.
  const order = usePurchaseOrder(moneyVisible && selected && !blocked ? selected.id : '');
  const unitPrices = useMemo(
    () =>
      Object.fromEntries(
        (activeRevision(order.data?.revisions ?? [])?.lines ?? []).map((line) => [line.id, line.unitPrice]),
      ) as Record<string, string>,
    [order.data],
  );

  const prefilled = useMemo(() => (selected ? grnLinesFromReceivable(selected.lines) : null), [selected]);
  const lines = edited ?? prefilled;

  const projectName = selected && selected.projects.length > 0 ? selected.projects.map((p) => p.name).join(', ') : null;
  const supplierName = selected?.supplier.name ?? tc('notAvailable');

  const poOptions = useMemo(
    () =>
      orders.map((po) => ({
        value: po.id,
        label: `${po.poNumber} · ${po.supplier.name}`,
        caption: po.projects.length > 0 ? po.projects.map((p) => p.name).join(', ') : undefined,
      })),
    [orders],
  );

  const selectPo = (id: string) => {
    setPurchaseOrderId(id);
    setEdited(null);
    setShowErrors(false);
    setReceiveError(null);
    createdIdRef.current = null;
  };

  // ── Validation ──────────────────────────────────────────────────────────────────
  const submittable = submittableGrnLines(lines ?? []);
  const lineErrors = (lines ?? []).map(grnLineErrors);
  const summaryErrors: FormFieldError[] = [];
  if (!purchaseOrderId) {
    summaryErrors.push({ label: t('purchaseOrder'), fieldId: 'grn-po', message: tErr('purchaseOrder') });
  }
  lineErrors.forEach((errors, i) => {
    const label = t('lineTitle', { n: i + 1 });
    if (errors.rejected) {
      summaryErrors.push({ label, fieldId: grnLineControlId('rejected', i), message: tErr(errors.rejected) });
    }
    if (errors.reason) {
      summaryErrors.push({ label, fieldId: grnLineControlId('reason', i), message: tErr(errors.reason) });
    }
  });
  if (lines && lines.length > 0 && submittable.length === 0) {
    summaryErrors.push({
      label: t('arrivedSection'),
      fieldId: grnLineControlId('delivered', 0),
      message: tErr('nothingDelivered'),
    });
  }
  const showSummary = (showErrors && summaryErrors.length > 0) || receiveError !== null;

  const dirty = Boolean(purchaseOrderId && purchaseOrderId !== initialPoId) || edited !== null || deliveryNoteRef.trim() !== '';
  const leave = () => router.push('/procurement/grn');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (summaryErrors.length > 0 || !lines) return;
    setConfirming(true);
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
          lines: submittableGrnLines(lines ?? []).map(toGrnLinePayload),
        });
        createdIdRef.current = grn.id;
      }

      // A held receipt (A1) is never forced through. The server does not hold over-receipts
      // today — it flags them and lets them post — but if it ever does, respect the hold.
      if (grn.status === 'EXCEPTION_PENDING') {
        router.push(`/procurement/grn/${grn.id}`);
        return;
      }

      await post.mutateAsync({ id: grn.id });
      router.push(`/procurement/grn/${grn.id}`);
    } catch (e) {
      setConfirming(false);
      if (isCreatorCannotReceive(e)) {
        setRefusedPoIds((current) => new Set(current).add(purchaseOrderId));
        return;
      }
      setReceiveError(e instanceof ApiError ? e.message : tc('loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [create, post, router, purchaseOrderId, deliveryDate, deliveryNoteRef, lines, tc]);

  // ── States before the form ─────────────────────────────────────────────────────
  if (receivable.isPending) return <SkeletonRecord label={tc('loading')} />;
  if (receivable.isError) {
    return (
      <Alert
        variant="error"
        messages={[tc('loadFailed')]}
        action={
          <Button type="button" variant="outline" onClick={() => void receivable.refetch()}>
            {tc('retry')}
          </Button>
        }
      />
    );
  }
  if (orders.length === 0) {
    return (
      <EmptyState
        title={t('nothingTitle')}
        description={t('nothingBody')}
        action={
          <Button asChild variant="outline">
            <Link href="/procurement/orders">{t('goToOrders')}</Link>
          </Button>
        }
      />
    );
  }

  const acceptedMinor =
    moneyVisible && lines && order.data
      ? acceptedValueMinor(lines.map((line) => ({ ...line, unitPrice: unitPrices[line.purchaseOrderLineId] ?? null })))
      : 0;
  const pendingException =
    selected?.receiptException && selected.receiptException.status !== 'REJECTED' ? selected.receiptException : null;

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        <FormActionBar
          save={
            blocked ? null : (
              <Button type="submit" loading={busy} loadingText={t('posting')}>
                {t('post')}
              </Button>
            )
          }
          discard={
            <Button type="button" variant="ghost" onClick={() => (dirty ? setConfirmLeave(true) : leave())}>
              {t('discard')}
            </Button>
          }
          saveState={dirty ? 'dirty' : 'new'}
          saveStateLabels={{ new: tForm('new'), dirty: tForm('dirty'), clean: tForm('clean') }}
        />

        <div className="space-y-8">
          <div className="scroll-mt-32">
            {showSummary ? (
              <FormErrorSummary
                errors={showErrors ? summaryErrors : []}
                formErrors={receiveError ? [receiveError] : []}
              />
            ) : null}
          </div>

          <section aria-labelledby="grn-delivery" className="space-y-4">
            <h2 id="grn-delivery" className="border-b border-border pb-2 text-body font-semibold text-foreground">
              {t('deliverySection')}
            </h2>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <FormField
                htmlFor="grn-po"
                label={t('purchaseOrder')}
                required
                hint={
                  selected
                    ? projectName
                      ? t('poPicked', { supplier: supplierName, project: projectName })
                      : supplierName
                    : t('poHint')
                }
                error={showErrors && !purchaseOrderId ? tErr('purchaseOrder') : undefined}
                className="sm:col-span-2"
              >
                <Combobox
                  id="grn-po"
                  value={purchaseOrderId}
                  onChange={selectPo}
                  options={poOptions}
                  placeholder={t('poPlaceholder')}
                  searchPlaceholder={t('poSearch')}
                  emptyLabel={t('poEmpty')}
                  invalid={showErrors && !purchaseOrderId}
                  aria-required
                />
              </FormField>

              <FormField htmlFor="grn-date" label={t('deliveredOn')} required>
                <DatePicker id="grn-date" value={deliveryDate} onChange={(value) => setDeliveryDate(value)} />
              </FormField>

              <FormField
                htmlFor="grn-note"
                label={`${t('deliveryNote')} (${t('optional')})`}
                hint={t('deliveryNoteHint')}
              >
                <Input id="grn-note" value={deliveryNoteRef} onChange={(e) => setDeliveryNoteRef(e.target.value)} />
              </FormField>
            </div>
          </section>

          {blocked ? (
            <Notice
              tone="attention"
              title={t('sod.title')}
              action={
                pendingException ? undefined : (
                  <Button type="button" variant="outline" onClick={() => setRequestingException(true)}>
                    {t('sod.request')}
                  </Button>
                )
              }
            >
              {pendingException ? t('sod.pending') : t('sod.body')}
            </Notice>
          ) : selected ? (
            <section aria-labelledby="grn-arrived" className="space-y-4">
              <div className="border-b border-border pb-2">
                <h2 id="grn-arrived" className="text-body font-semibold text-foreground">
                  {t('arrivedSection')}
                </h2>
                <p className="text-caption text-muted-foreground">{t('arrivedHint')}</p>
              </div>

              {lines ? <GrnLineEditor lines={lines} onChange={setEdited} showErrors={showErrors} /> : null}

              {moneyVisible && lines && acceptedMinor > 0 ? (
                <p className="text-body-sm text-muted-foreground" aria-live="polite">
                  {t('acceptedValue', {
                    amount: formatMoney(fromMinorUnits(acceptedMinor, MONEY_SCALE), 'USD') ?? '',
                  })}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </form>

      {confirming ? (
        <ConfirmActionDialog
          title={t('confirmTitle')}
          description={
            lines && anyOverStillDue(submittableGrnLines(lines))
              ? `${t('confirmBody')} ${t('confirmOverReceipt')}`
              : t('confirmBody')
          }
          confirmLabel={t('post')}
          isPending={busy}
          onConfirm={() => void runReceive()}
          onDismiss={() => setConfirming(false)}
        />
      ) : null}

      {requestingException && selected ? (
        <ConfirmActionDialog
          title={t('sod.dialogTitle')}
          description={t('sod.dialogBody')}
          confirmLabel={t('sod.submit')}
          reason={{ required: true, label: t('sod.reasonLabel') }}
          isPending={requestException.isPending}
          errorMessage={requestException.error ? errorText(requestException.error, tc('loadFailed')) : undefined}
          onConfirm={(reason) =>
            requestException.mutate(
              { purchaseOrderId: selected.id, reason: reason.trim() },
              { onSuccess: () => setRequestingException(false) },
            )
          }
          onDismiss={() => {
            requestException.reset();
            setRequestingException(false);
          }}
        />
      ) : null}

      {confirmLeave ? (
        <ConfirmActionDialog
          title={tCommon('unsavedChanges.title')}
          description={tCommon('unsavedChanges.body')}
          confirmLabel={tCommon('unsavedChanges.leave')}
          isPending={false}
          onConfirm={leave}
          onDismiss={() => setConfirmLeave(false)}
        />
      ) : null}
    </>
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
  useModuleTrail(grn.data?.grnNumber);
  const [posting, setPosting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [approvingException, setApprovingException] = useState(false);
  const cancel = useCancelGoodsReceipt();
  const post = usePostGoodsReceipt();
  const approveException = useApproveGoodsReceiptException();

  if (grn.isPending) {
    return (
      <div role="status" aria-live="polite">
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (grn.isError || !grn.data) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const receipt: GoodsReceipt = grn.data;
  const q = (v: string) => parseMinorUnits(v, QUANTITY_SCALE) ?? 0;
  const canApproveException = can(PROCUREMENT_PERMISSIONS.approveReceiptException);

  const poNumber = receipt.purchaseOrder?.poNumber ?? receipt.purchaseOrder?.number ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/procurement/grn"
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        >
          <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          {t('backToList')}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {receipt.grnNumber}
          </h2>
          <div className="mt-2">
            <ProcurementStatusBadge vocabulary="grn" status={receipt.status} />
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

      {receipt.overReceiptFlag ? (
        <Alert variant="warning" title={t('overReceiptTitle')} messages={[t('overReceiptBody')]} />
      ) : null}

      <dl className="grid gap-4 rounded-panel border border-border bg-surface p-4 shadow-e2 sm:grid-cols-2 lg:grid-cols-5">
        <Field
          label={t('deliveryDate')}
          value={formatDate(receipt.deliveryDate, locale) ?? tc('notAvailable')}
        />
        <Field label={t('deliveryNoteRef')} value={receipt.deliveryNoteRef ?? tc('notAvailable')} />
        <Field
          label={t('purchaseOrder')}
          value={
            poNumber ? (
              <Link
                href={`/procurement/orders/${receipt.purchaseOrderId}`}
                className="font-medium text-brand-primary underline-offset-2 hover:underline"
              >
                {poNumber}
              </Link>
            ) : (
              tc('notAvailable')
            )
          }
        />
        <Field label={t('supplier')} value={receipt.supplier?.name ?? tc('notAvailable')} />
        <Field
          label={t('postedOn')}
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
                      PO line. The cost-target is inherited from the PO line too (no. 150), but the
                      GR read model does not embed it — the GR line has no projectId/boqNodeId
                      and the repository does not join the PO line — so no cost-target chip is
                      shown here rather than a faked one. Tracked as a backend follow-up (see
                      the report / no. 150): the GR line read model needs the PO line's
                      project/boqNode for this chip to light up. Only the type chip renders. */}
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

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
