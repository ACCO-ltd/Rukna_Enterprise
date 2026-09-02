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
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  Input,
  Dialog,
  DialogContent,
  DialogTitle,
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
    costTarget:
      line.projectId && line.boqNodeId
        ? { notChargeable: false, projectId: line.projectId, boqNodeId: line.boqNodeId }
        : { notChargeable: true, projectId: null, boqNodeId: null },
  }));
}

export function PoAmendSheet({
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

  const [effectiveFrom, setEffectiveFrom] = useState(
    source?.effectiveFrom?.slice(0, 10) ?? today(),
  );
  const [deliveryAddress, setDeliveryAddress] = useState(source?.deliveryAddress ?? '');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(
    source?.expectedDeliveryDate?.slice(0, 10) ?? '',
  );
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<PoLineDraft[]>(() => linesFromRevision(source));
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
        // A3 (no. 148): a chargeable line sends both cost-target ids; a not-chargeable line sends
        // neither. The revise DTO validates the target the same way create does.
        const costTarget =
          !line.costTarget.notChargeable && line.costTarget.projectId && line.costTarget.boqNodeId
            ? { projectId: line.costTarget.projectId, boqNodeId: line.costTarget.boqNodeId }
            : {};
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

  const serverError =
    revise.error instanceof ApiError ? revise.error.message : revise.error ? tc('loadFailed') : null;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      {/* The one panel that was genuinely large: it hosts the same line editor the create
          screen uses. It had already written `max-w-2xl` inside a 420px drawer that could
          never honour it — the width it was asking for is what it gets here. */}
      <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-4xl">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <DialogTitle className="text-lg font-semibold text-foreground">
            {t('amendTitle', { number: order.poNumber })}
          </DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('amendBody')}</p>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
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

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {tc('lines')}
            </h3>
            <PoLineEditor
              lines={lines}
              onChange={setLines}
              currencyCode={currencyCode}
              showErrors={showErrors}
            />
          </div>

          {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
          <p className="text-sm">
            <span className="text-muted-foreground">{tc('total')}: </span>
            <span className="font-semibold tabular-nums">{totalLabel}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={revise.isPending}>
              {tc('cancel')}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={revise.isPending}>
              {t('amendConfirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
