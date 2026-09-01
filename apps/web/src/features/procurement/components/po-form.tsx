'use client';

/**
 * Purchase order creation (Round 2, single-form).
 *
 * The Sprint-5 two-step wizard is collapsed into one screen: header fields and the line
 * editor together, with a sticky footer that holds the running total and the single
 * primary action. All prior validation and error states are preserved.
 *
 * ─── D3: one action, "Issue purchase order" ─────────────────────────────────────────
 *
 * The primary action performs the direct issue path by orchestrating the existing
 * endpoints as one user action: create (DRAFT) → submit (DRAFT→SUBMITTED) → approve
 * (SUBMITTED→ACTIVE, which writes the COMMITTED commitment-ledger entries). The ceremonial
 * approve step is removed from the create UX.
 *
 * Submit is the governed transition (ADR-011). With no DoA binding it proceeds and we go
 * straight on to approve; with a binding it returns 409 carrying an `approvalInstanceId`,
 * the server having opened an approval instead of transitioning. We hold that id, render
 * the real {@link ApprovalPanel}, and offer a "Complete issue" re-drive — the same honest
 * gate seam every governed action uses. We never fabricate an approval: if a chain is
 * pending, the order stays SUBMITTED until approvers act.
 *
 * "Save draft" stops after create — the order sits as a DRAFT the user can issue later
 * from its detail page.
 *
 * Because create runs first, a governance/SoD refusal (e.g. ADR-022 CONST-DOA-003, where
 * the supplier's own maintainer may not raise a PO to that supplier) surfaces as the
 * create step's own 4xx and is shown verbatim — not hidden and not faked.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input } from '@erp/ui';
import { WorkflowTransactionType } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';
import { formatMoney } from '@/lib/format';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';

import {
  useApprovePurchaseOrder,
  useCreatePurchaseOrder,
  useSubmitPurchaseOrder,
} from '../hooks/use-procurement';
import { moneyToApi, quantityToApi } from '../quantities';
import type { CreatePoLinePayload, CreatePurchaseOrderPayload } from '../types';
import {
  PoLineEditor,
  emptyPoLine,
  orderTotalMinor,
  poLineError,
  type PoLineDraft,
} from './po-line-editor';
import { SupplierPicker } from './supplier-picker';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PoForm() {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const router = useRouter();

  const [supplierId, setSupplierId] = useState('');
  // Single-currency platform (ADR-024): USD is implicit, never entered.
  const currencyCode = 'USD';
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [lines, setLines] = useState<PoLineDraft[]>([emptyPoLine('line-1')]);
  const [showErrors, setShowErrors] = useState(false);

  // The one issue in progress: null → not started, the id once created, and the
  // approval instance id if submit gated. `busy` covers the whole orchestration.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [approvalInstanceId, setApprovalInstanceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  // A create that already succeeded must not run again on a retry after a later step failed.
  const orderIdRef = useRef<string | null>(null);

  const ids = {
    supplier: useId(),
    effective: useId(),
    address: useId(),
    expected: useId(),
  };

  const create = useCreatePurchaseOrder();
  const submit = useSubmitPurchaseOrder();
  const approve = useApprovePurchaseOrder();

  const hasLineError = lines.some((l) => poLineError(l) !== null);
  const totalMinor = orderTotalMinor(lines);
  const totalLabel =
    totalMinor === null
      ? tc('notAvailable')
      : formatMoney(fromMinorUnits(totalMinor, MONEY_SCALE), currencyCode, 'en');

  function buildPayload(): CreatePurchaseOrderPayload {
    return {
      supplierId,
      currencyCode,
      effectiveFrom,
      ...(deliveryAddress.trim() ? { deliveryAddress: deliveryAddress.trim() } : {}),
      ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
      lines: lines.map((line): CreatePoLinePayload => {
        const qty = parseMinorUnits(line.quantity, QUANTITY_SCALE) ?? 0;
        const price = parseMinorUnits(line.unitPrice, MONEY_SCALE) ?? 0;
        return {
          lineType: line.lineType,
          description: line.description.trim(),
          uomCode: line.material?.baseUom?.code ?? line.uomCode,
          orderedQuantity: quantityToApi(qty),
          unitPrice: moneyToApi(price),
          ...(line.material ? { materialCode: line.material.code } : {}),
          // D7: spendCategoryId is derived at issue, so it is omitted (it is optional on
          // the PO-line API). D2: no mrLineAllocations — PO lines don't reference MR lines.
        };
      }),
    };
  }

  function validate(): boolean {
    setShowErrors(true);
    return !hasLineError && Boolean(supplierId);
  }

  /** Create the DRAFT once, reusing the id if a prior attempt already created it. */
  const ensureCreated = useCallback(async (): Promise<string> => {
    if (orderIdRef.current) return orderIdRef.current;
    const po = await create.mutateAsync(buildPayload());
    orderIdRef.current = po.id;
    setCreatedId(po.id);
    return po.id;
    // buildPayload reads current state; it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create]);

  function handleSaveDraft() {
    if (!validate()) return;
    setIssueError(null);
    setBusy(true);
    void (async () => {
      try {
        const id = await ensureCreated();
        router.push(`/procurement/orders/${id}`);
      } catch (e) {
        setIssueError(e instanceof ApiError ? e.message : tc('loadFailed'));
      } finally {
        setBusy(false);
      }
    })();
  }

  /**
   * Create → submit (gated) → approve. If submit gates, hold the approval instance and
   * wait; "Complete issue" re-runs from submit once approvers have acted.
   */
  const runIssue = useCallback(async () => {
    setIssueError(null);
    setBusy(true);
    try {
      const id = await ensureCreated();

      try {
        await submit.mutateAsync(id);
      } catch (e) {
        // 409 with an approvalInstanceId is the gate, not a failure: a DoA binding exists
        // and the server opened an approval instead of moving to SUBMITTED.
        const instanceId =
          e instanceof ApiError && e.status === 409
            ? (e.details?.approvalInstanceId as string | undefined)
            : undefined;
        if (instanceId) {
          setApprovalInstanceId(instanceId);
          return; // wait for approvers; the order stays DRAFT/SUBMITTED, nothing faked
        }
        throw e;
      }

      setApprovalInstanceId(null);
      await approve.mutateAsync({ id });
      router.push(`/procurement/orders/${id}`);
    } catch (e) {
      setIssueError(e instanceof ApiError ? e.message : tc('loadFailed'));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureCreated, submit, approve, router]);

  function handleIssue() {
    if (!validate()) return;
    void runIssue();
  }

  return (
    <div className="space-y-6 pb-28">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('createTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('createSubtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor={ids.supplier} label={tc('supplier')}>
          <SupplierPicker id={ids.supplier} value={supplierId} onChange={setSupplierId} required />
          {showErrors && !supplierId ? (
            <p className="mt-1 text-xs font-medium text-danger" role="alert">
              {t('supplierRequired')}
            </p>
          ) : null}
        </FormField>

        <FormField htmlFor={ids.effective} label={t('effectiveFrom')}>
          <Input
            id={ids.effective}
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </FormField>

        <FormField htmlFor={ids.address} label={`${t('deliveryAddress')} (${tc('optional')})`}>
          <Input
            id={ids.address}
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
          />
        </FormField>

        <FormField htmlFor={ids.expected} label={`${t('expectedDelivery')} (${tc('optional')})`}>
          <Input
            id={ids.expected}
            type="date"
            value={expectedDeliveryDate}
            onChange={(e) => setExpectedDeliveryDate(e.target.value)}
          />
        </FormField>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {tc('lines')}
        </h2>
        <PoLineEditor
          lines={lines}
          onChange={setLines}
          currencyCode={currencyCode}
          showErrors={showErrors}
        />
      </div>

      {issueError ? <Alert variant="error" messages={[issueError]} /> : null}

      {/* Gate: shown only when a DoA binding actually opened an approval on submit.
          The order is created and awaiting approval; "Complete issue" re-drives. */}
      {approvalInstanceId ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-6">
          <Alert variant="info" messages={[t('issueAwaitingApproval')]} />
          <ApprovalPanel
            instanceId={approvalInstanceId}
            transactionType={WorkflowTransactionType.PURCHASE_ORDER}
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <Button type="button" disabled={busy} onClick={() => void runIssue()}>
              {t('completeIssue')}
            </Button>
            {createdId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/procurement/orders/${createdId}`)}
              >
                {t('backToList')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── Sticky footer: running total + the single primary action ──────────────── */}
      {approvalInstanceId ? null : (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="text-sm" aria-live="polite">
              <span className="text-muted-foreground">{tc('total')}: </span>
              <span className="font-semibold tabular-nums">{totalLabel}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={handleSaveDraft}
              >
                {t('saveDraft')}
              </Button>
              <Button type="button" disabled={busy} onClick={handleIssue}>
                {t('issueOrder')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
