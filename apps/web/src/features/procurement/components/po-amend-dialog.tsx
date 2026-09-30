'use client';

/**
 * Amend a purchase order — the only revision-creating action (D3/B3).
 *
 * Opens the same MR-free, single-form line editor the create screen uses, pre-filled from
 * the current active revision, and calls the existing `revise` endpoint. That writes a new
 * DRAFT revision; issuing it (submit → approve) happens back on the detail page, through
 * the same governed seam as a first issue.
 *
 * `reason` is required by the `revise` DTO. `supplierId` is required by the DTO and
 * discarded by the service (P13) — the PO's existing value is resent.
 *
 * A `FormDialog` (ADR-039), size `xl`: the revision's header fields and its line table. The
 * order total sits on the footer's start edge, beside Cancel and the primary.
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  Input,
  Textarea,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';
import { formatMoney } from '@/lib/format';

import { useRevisePurchaseOrder } from '../hooks/use-procurement';
import { moneyToApi, quantityToApi } from '../quantities';
import type {
  CreatePoLinePayload,
  PurchaseOrder,
  PurchaseOrderRevision,
  RevisePurchaseOrderPayload,
} from '../types';
import {
  PoLineEditor,
  emptyPoLine,
  orderTotalMinor,
  poLineCostTargetIncomplete,
  poLineError,
  type PoLineDraft,
} from './po-line-editor';
import { buildCostTargetPayload } from './po-cost-target-picker';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Pre-fill draft lines from a revision. Material is left null — the picker resolves it.
 *
 * The cost-target is carried forward from the source line (A3/D7, no. 148): a line that pointed
 * at a project/BOQ node keeps it, and an org/overhead line stays marked not-chargeable, so
 * an amendment does not silently drop the cost attribution. Both ids are present together on
 * the read model or both null, mirroring the invariant.
 */
function linesFromRevision(revision: PurchaseOrderRevision | null): PoLineDraft[] {
  const source = revision?.lines ?? [];
  if (source.length === 0) return [emptyPoLine('line-1')];
  return source.map((line, i) => ({
    key: `rev-${line.id ?? i}`,
    lineType: line.lineType,
    material: null,
    description: line.material ? `${line.material.name}` : line.description,
    uomCode: line.uom?.code ?? '',
    quantity: line.orderedQuantity,
    unitPrice: line.unitPrice,
    costTarget: line.projectId
      ? {
          notChargeable: false,
          projectId: line.projectId,
          boqNodeId: line.boqNodeId ?? null,
          spendCategoryId: line.boqNodeId ? null : (line.spendCategoryId ?? null),
        }
      : { notChargeable: true, projectId: null, boqNodeId: null, spendCategoryId: null },
  }));
}

export function PoAmendDialog({
  order,
  source,
  onClose,
}: {
  order: PurchaseOrder;
  /** The revision the amendment starts from (the current active one). */
  source: PurchaseOrderRevision | null;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');

  const revise = useRevisePurchaseOrder();

  // What the dialog opened with — seeded once, so the dirty check compares against it.
  const [initial] = useState(() => ({
    effectiveFrom: source?.effectiveFrom?.slice(0, 10) ?? today(),
    deliveryAddress: source?.deliveryAddress ?? '',
    expectedDeliveryDate: source?.expectedDeliveryDate?.slice(0, 10) ?? '',
    lines: linesFromRevision(source),
  }));
  const [effectiveFrom, setEffectiveFrom] = useState(initial.effectiveFrom);
  const [deliveryAddress, setDeliveryAddress] = useState(initial.deliveryAddress);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(initial.expectedDeliveryDate);
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<PoLineDraft[]>(initial.lines);
  const [showErrors, setShowErrors] = useState(false);

  const ids = { effective: useId(), address: useId(), expected: useId(), reason: useId() };

  const currencyCode = source?.currencyCode ?? 'USD';
  const hasLineError = lines.some(
    (l) => poLineError(l) !== null || poLineCostTargetIncomplete(l),
  );
  const reasonMissing = reason.trim().length === 0;

  const totalMinor = orderTotalMinor(lines);
  const totalLabel =
    totalMinor === null
      ? tc('notAvailable')
      : formatMoney(fromMinorUnits(totalMinor, MONEY_SCALE), currencyCode, 'en');

  function handleSubmit() {
    setShowErrors(true);
    if (hasLineError || reasonMissing) return;

    const payload: RevisePurchaseOrderPayload = {
      // Discarded by the service (P13) but required by the DTO — resend the PO's own value.
      supplierId: order.supplierId,
      currencyCode,
      effectiveFrom,
      reason: reason.trim(),
      ...(deliveryAddress.trim() ? { deliveryAddress: deliveryAddress.trim() } : {}),
      ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
      lines: lines.map((line): CreatePoLinePayload => {
        const qty = parseMinorUnits(line.quantity, QUANTITY_SCALE) ?? 0;
        const price = parseMinorUnits(line.unitPrice, MONEY_SCALE) ?? 0;
        // A3: the revise DTO validates the target exactly as create does — project plus
        // either a BOQ node or a spend category, or nothing at all for overhead.
        const costTarget = buildCostTargetPayload(line.costTarget);
        return {
          lineType: line.lineType,
          description: line.description.trim(),
          uomCode: line.material?.baseUom?.code ?? line.uomCode,
          orderedQuantity: quantityToApi(qty),
          unitPrice: moneyToApi(price),
          ...(line.material ? { materialCode: line.material.code } : {}),
          ...costTarget,
        };
      }),
    };

    revise.mutate(
      { id: order.id, payload },
      { onSuccess: onClose },
    );
  }

  // The line editor replaces the array on every edit, so identity is enough to tell "touched".
  const dirty =
    effectiveFrom !== initial.effectiveFrom ||
    deliveryAddress !== initial.deliveryAddress ||
    expectedDeliveryDate !== initial.expectedDeliveryDate ||
    reason !== '' ||
    lines !== initial.lines;

  const serverError =
    revise.error instanceof ApiError ? revise.error.message : revise.error ? tc('loadFailed') : null;

  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={t('amendTitle', { number: order.poNumber })}
      subtitle={t('amendBody')}
      size="xl"
      dirty={dirty}
      busy={revise.isPending}
    >
      <FormDialogBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor={ids.effective} label={t('effectiveFrom')}>
            <DatePicker
              id={ids.effective}
              value={effectiveFrom}
              onChange={(value) => setEffectiveFrom(value)}
            />
          </FormField>

          <FormField htmlFor={ids.expected} label={`${t('expectedDelivery')} (${tc('optional')})`}>
            <DatePicker
              id={ids.expected}
              value={expectedDeliveryDate}
              onChange={(value) => setExpectedDeliveryDate(value)}
            />
          </FormField>

          <FormField
            htmlFor={ids.address}
            label={`${t('deliveryAddress')} (${tc('optional')})`}
            className="sm:col-span-2"
          >
            <Input
              id={ids.address}
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
            />
          </FormField>

          <FormField htmlFor={ids.reason} label={t('reason')} className="sm:col-span-2">
            <Textarea
              id={ids.reason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={showErrors && reasonMissing ? true : undefined}
            />
            {showErrors && reasonMissing ? (
              <p className="mt-1 text-xs font-medium text-danger" role="alert">
                {t('reasonRequired')}
              </p>
            ) : null}
          </FormField>
        </div>

        {/* The same line editor the create screen uses — the reason this dialog is `xl`. */}
        <FormDialogSection title={tc('lines')} variant="plain">
          <PoLineEditor
            lines={lines}
            onChange={setLines}
            currencyCode={currencyCode}
            showErrors={showErrors}
          />
        </FormDialogSection>

        {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
      </FormDialogBody>

      <FormDialogFooter
        start={
          <p className="text-sm">
            <span className="text-muted-foreground">{tc('total')}: </span>
            <span className="font-semibold tabular-nums">{totalLabel}</span>
          </p>
        }
      >
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={revise.isPending}>
            {tc('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="button" onClick={handleSubmit} loading={revise.isPending}>
          {t('amendConfirm')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
