'use client';

/**
 * "What arrived" — the receive-a-delivery line editor.
 *
 * Every open PO line is one row, prefilled with what is still due, so a normal delivery is
 * posted without touching a field. The receiver changes only what is different:
 *
 *  - **Delivered now** — less is fine (the rest stays open on the order); more is not an error.
 *    Over-receipt policy (A1) records ≤ the tolerance and flags it, and holds the receipt for
 *    review above it — the server decides which, so the line only says so in words.
 *  - **Report a problem** opens Rejected quantity + Reason under that line only. Accepted is
 *    derived (delivered − rejected) and so is the quality status sent to the API.
 *
 * Quantities are held as typed strings and parsed to minor units, so a half-typed "1." is
 * never rejected while it is being written.
 */

import { useTranslations } from 'next-intl';
import { FormField, Input, LineItemsEditor, QuantityInput, type LineColumn, type LineNote } from '@erp/ui';

import { formatNumber } from '@/lib/format';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { overReceiptState, quantityToApi } from '../quantities';
import type { CreateGrnLinePayload, QualityStatus, ReceivablePoLine } from '../types';

export interface GrnLineDraft {
  key: string;
  purchaseOrderLineId: string;
  description: string;
  uomSymbol: string;
  orderedQuantity: string;
  /** Accepted on earlier receipts against this line. */
  receivedBefore: string;
  /** Unit price on the PO line — for the accepted-value summary only. */
  unitPrice: string | null;
  delivered: string;
  problemOpen: boolean;
  rejected: string;
  reason: string;
}

export type GrnLineErrorKey = 'rejectedOverDelivered' | 'reasonRequired';
export type GrnLineErrors = Partial<Record<'rejected' | 'reason', GrnLineErrorKey>>;

const q = (value: string | null | undefined) => parseMinorUnits(value ?? null, QUANTITY_SCALE) ?? 0;

export function stillDueMinor(line: Pick<GrnLineDraft, 'orderedQuantity' | 'receivedBefore'>): number {
  return Math.max(q(line.orderedQuantity) - q(line.receivedBefore), 0);
}

/**
 * One row per open line on a receivable order, each prefilled with what is still due. Prices are
 * not on the receivable read; pass the order's unit prices (by PO line id) when the viewer may
 * see money, for the accepted-value summary.
 */
export function grnLinesFromReceivable(
  lines: readonly ReceivablePoLine[],
  unitPriceByLineId: Record<string, string> = {},
): GrnLineDraft[] {
  return lines.map((line) => {
    const draft: GrnLineDraft = {
      key: line.purchaseOrderLineId,
      purchaseOrderLineId: line.purchaseOrderLineId,
      description: line.description,
      uomSymbol: line.uomSymbol || line.uomCode,
      orderedQuantity: line.orderedQuantity,
      receivedBefore: line.acceptedQuantity,
      unitPrice: unitPriceByLineId[line.purchaseOrderLineId] ?? null,
      delivered: '',
      problemOpen: false,
      rejected: '',
      reason: '',
    };
    const due = stillDueMinor(draft);
    // Typed-looking, not padded: "60", not "60.000".
    return { ...draft, delivered: due > 0 ? fromMinorUnits(due, QUANTITY_SCALE).replace(/\.?0+$/, '') : '' };
  });
}

/** Delivered / accepted / rejected in minor units, and the quality status they imply. */
export function grnLineOutcome(line: GrnLineDraft): {
  receivedMinor: number;
  acceptedMinor: number;
  rejectedMinor: number;
  qualityStatus: QualityStatus;
} {
  const receivedMinor = q(line.delivered);
  const rejectedMinor = line.problemOpen ? Math.min(q(line.rejected), receivedMinor) : 0;
  const acceptedMinor = receivedMinor - rejectedMinor;
  const qualityStatus: QualityStatus =
    rejectedMinor === 0 ? 'ACCEPTED' : acceptedMinor === 0 ? 'REJECTED' : 'PARTIALLY_ACCEPTED';
  return { receivedMinor, acceptedMinor, rejectedMinor, qualityStatus };
}

export function grnLineErrors(line: GrnLineDraft): GrnLineErrors {
  if (!line.problemOpen) return {};
  const errors: GrnLineErrors = {};
  const rejected = q(line.rejected);
  if (rejected > q(line.delivered)) errors.rejected = 'rejectedOverDelivered';
  if (rejected > 0 && line.reason.trim() === '') errors.reason = 'reasonRequired';
  return errors;
}

/** The rows that will be sent — a line nothing arrived on is not part of this delivery. */
export function submittableGrnLines(lines: readonly GrnLineDraft[]): GrnLineDraft[] {
  return lines.filter((line) => q(line.delivered) > 0);
}

export function toGrnLinePayload(line: GrnLineDraft): CreateGrnLinePayload {
  const outcome = grnLineOutcome(line);
  return {
    purchaseOrderLineId: line.purchaseOrderLineId,
    receivedQuantity: quantityToApi(outcome.receivedMinor),
    acceptedQuantity: quantityToApi(outcome.acceptedMinor),
    ...(outcome.rejectedMinor > 0
      ? { rejectedQuantity: quantityToApi(outcome.rejectedMinor), rejectionReason: line.reason.trim() }
      : {}),
    qualityStatus: outcome.qualityStatus,
  };
}

/** Σ accepted × PO unit price, in cents — what moves from ordered to received on posting. */
export function acceptedValueMinor(lines: readonly GrnLineDraft[]): number {
  return lines.reduce((sum, line) => {
    const price = parseMinorUnits(line.unitPrice, MONEY_SCALE);
    if (price === null) return sum;
    return sum + Math.round((grnLineOutcome(line).acceptedMinor * price) / 10 ** QUANTITY_SCALE);
  }, 0);
}

export const grnLineControlId = (column: string, index: number) => `grn-line-${index}-${column}`;

export function GrnLineEditor({
  lines,
  onChange,
  showErrors,
}: {
  lines: GrnLineDraft[];
  onChange: (lines: GrnLineDraft[]) => void;
  showErrors: boolean;
}) {
  const t = useTranslations('procurement.grn.receive');
  const tErr = useTranslations('procurement.grn.receive.errors');

  const update = (index: number, patch: Partial<GrnLineDraft>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const qty = (minor: number, unit: string) =>
    `${formatNumber(Number(fromMinorUnits(minor, QUANTITY_SCALE)))}${unit ? ` ${unit}` : ''}`;

  const columns: LineColumn<GrnLineDraft>[] = [
    {
      key: 'item',
      header: t('columns.item'),
      width: 'minmax(0,2.4fr)',
      cell: (line) => (
        <span className="block min-w-0 pt-1">
          <span className="block truncate text-body-sm font-medium text-foreground">{line.description}</span>
          <span className="block text-caption text-muted-foreground">
            {t('orderedBefore', {
              ordered: qty(q(line.orderedQuantity), line.uomSymbol),
              before: qty(q(line.receivedBefore), line.uomSymbol),
            })}
          </span>
        </span>
      ),
    },
    {
      key: 'stillDue',
      header: t('columns.stillDue'),
      width: '7rem',
      align: 'end',
      cell: (line) => (
        <span className="block pt-2 text-body-sm tabular-nums text-foreground">
          {qty(stillDueMinor(line), line.uomSymbol)}
        </span>
      ),
    },
    {
      key: 'deliveredNow',
      header: t('columns.deliveredNow'),
      width: '9.5rem',
      align: 'end',
      controlId: (i) => grnLineControlId('delivered', i),
      cell: (line, i) => (
        <QuantityInput
          id={grnLineControlId('delivered', i)}
          value={line.delivered}
          unit={line.uomSymbol || undefined}
          onValueChange={(value) => update(i, { delivered: value })}
        />
      ),
    },
    {
      key: 'problem',
      header: t('columns.problem'),
      width: '9rem',
      cell: (line, i) => (
        <button
          type="button"
          aria-expanded={line.problemOpen}
          aria-controls={`grn-line-${i}-problem`}
          onClick={() => update(i, line.problemOpen ? { problemOpen: false, rejected: '', reason: '' } : { problemOpen: true })}
          className="inline-flex min-h-10 items-center rounded-control px-1 text-body-sm font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:shadow-ring"
        >
          {line.problemOpen ? t('removeProblem') : t('reportProblem')}
        </button>
      ),
    },
  ];

  const note = (line: GrnLineDraft): LineNote | null => {
    const delivered = q(line.delivered);
    if (delivered === 0) return null;
    const due = stillDueMinor(line);
    if (delivered < due) return { tone: 'neutral', text: t('staysOpen', { qty: qty(due - delivered, line.uomSymbol) }) };
    const over = overReceiptState(q(line.orderedQuantity), q(line.receivedBefore), delivered);
    if (over.state === 'within') return null;
    const amount = qty(over.overByMinor, line.uomSymbol);
    return {
      tone: 'warning',
      text: over.state === 'exception' ? t('overException', { qty: amount }) : t('overTolerated', { qty: amount }),
    };
  };

  return (
    <LineItemsEditor<GrnLineDraft>
      label={t('linesLabel')}
      rows={lines}
      rowKey={(line) => line.key}
      columns={columns}
      cardTitle={(_line, i) => t('lineTitle', { n: i + 1 })}
      note={(line) => note(line)}
      detail={(line, i) => {
        if (!line.problemOpen) return null;
        const errors = showErrors ? grnLineErrors(line) : {};
        return (
          <div id={`grn-line-${i}-problem`} className="grid gap-3 rounded-panel bg-surface-subtle p-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <FormField
              htmlFor={grnLineControlId('rejected', i)}
              label={t('rejectedQty')}
              error={errors.rejected ? tErr(errors.rejected) : undefined}
            >
              <QuantityInput
                id={grnLineControlId('rejected', i)}
                value={line.rejected}
                unit={line.uomSymbol || undefined}
                onValueChange={(value) => update(i, { rejected: value })}
              />
            </FormField>
            <FormField
              htmlFor={grnLineControlId('reason', i)}
              label={t('reason')}
              hint={t('reasonHint')}
              error={errors.reason ? tErr(errors.reason) : undefined}
            >
              <Input
                id={grnLineControlId('reason', i)}
                value={line.reason}
                onChange={(event) => update(i, { reason: event.target.value })}
              />
            </FormField>
          </div>
        );
      }}
    />
  );
}
