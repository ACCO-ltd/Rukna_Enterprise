'use client';

/**
 * Goods receipt line editor (§12.7, step 2).
 *
 * Three server behaviours shape this component, and two of them are defects:
 *
 *  1. **`accepted + rejected` must equal `received`.** A real rule, checked live so the
 *     user fixes it before submitting rather than after.
 *
 *  2. **`receivedQuantity` and `acceptedQuantity` are both `@IsPositive()` (P6).** §12.7
 *     says to pre-populate one row per PO line, but a partial delivery leaves the
 *     untouched rows at zero and `@IsPositive()` refuses the whole request. So untouched
 *     rows are **dropped from the payload** rather than sent — `isEmptyGrnLine` decides
 *     which. The same validator makes a wholly rejected line impossible, so `REJECTED`
 *     is not offered in the quality select and `accepted = 0` is blocked with an
 *     explanation instead of an unexplained 400.
 *
 *  3. **Over-receipt tolerance is not knowable (P9).** It is resolved per organisation and
 *     spend category from an `OverReceiptPolicy` no endpoint exposes, falling back to 5%.
 *     The warning therefore never quotes a percentage — it says the delivery exceeds the
 *     order and may be held, which is true whatever the policy says.
 */

import { useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Alert, Input } from '@erp/ui';

import { formatNumber } from '@/lib/format';
import { QUANTITY_SCALE, parseMinorUnits } from '@/lib/money';

import {
  exceedsOverReceiptTolerance,
  isEmptyGrnLine,
  validateGrnLine,
  type GrnLineError,
} from '../quantities';
import type { PurchaseOrderLine, QualityStatus } from '../types';
import { QuantitySplit } from './material-picker';

/**
 * `REJECTED` is absent on purpose — it requires `acceptedQuantity: 0`, which the API
 * refuses (P6). Offering it would produce a body the server rejects every time.
 */
export const SELECTABLE_QUALITY: QualityStatus[] = [
  'PENDING_INSPECTION',
  'ACCEPTED',
  'PARTIALLY_ACCEPTED',
];

export interface GrnLineDraft {
  key: string;
  purchaseOrderLineId: string;
  description: string;
  uomSymbol: string;
  orderedQuantity: string;
  previouslyReceived: string;
  received: string;
  accepted: string;
  rejected: string;
  rejectionReason: string;
  qualityStatus: QualityStatus;
}

/** One draft row per ACTIVE-revision PO line, as §12.7 specifies. */
export function grnLinesFromPo(
  lines: readonly PurchaseOrderLine[],
  previouslyReceivedByLineId: Record<string, string> = {},
): GrnLineDraft[] {
  return lines.map((line) => ({
    key: line.id,
    purchaseOrderLineId: line.id,
    description: line.description,
    uomSymbol: line.uom?.symbol ?? line.uom?.code ?? '',
    orderedQuantity: line.orderedQuantity,
    previouslyReceived: previouslyReceivedByLineId[line.id] ?? '0',
    received: '',
    accepted: '',
    rejected: '',
    rejectionReason: '',
    qualityStatus: 'ACCEPTED',
  }));
}

export function grnLineQuantities(line: GrnLineDraft) {
  return {
    receivedMinor: parseMinorUnits(line.received, QUANTITY_SCALE) ?? 0,
    acceptedMinor: parseMinorUnits(line.accepted, QUANTITY_SCALE) ?? 0,
    rejectedMinor: parseMinorUnits(line.rejected, QUANTITY_SCALE) ?? 0,
  };
}

/** Untouched rows are not errors — they are simply not part of this delivery. */
export function grnLineError(line: GrnLineDraft): GrnLineError | null {
  const q = grnLineQuantities(line);
  if (isEmptyGrnLine(q)) return null;
  return validateGrnLine(q);
}

/** The rows that will actually be sent. */
export function submittableGrnLines(lines: readonly GrnLineDraft[]): GrnLineDraft[] {
  return lines.filter((l) => !isEmptyGrnLine(grnLineQuantities(l)));
}

interface GrnLineEditorProps {
  lines: GrnLineDraft[];
  onChange: (lines: GrnLineDraft[]) => void;
  showErrors: boolean;
}

export function GrnLineEditor({ lines, onChange, showErrors }: GrnLineEditorProps) {
  const t = useTranslations('procurement.grn');

  const update = (key: string, patch: Partial<GrnLineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const anyOverReceipt = lines.some((line) => {
    const q = grnLineQuantities(line);
    if (isEmptyGrnLine(q)) return false;
    return exceedsOverReceiptTolerance(
      parseMinorUnits(line.orderedQuantity, QUANTITY_SCALE) ?? 0,
      parseMinorUnits(line.previouslyReceived, QUANTITY_SCALE) ?? 0,
      q.receivedMinor,
    );
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('emptyLinesHint')}</p>

      {anyOverReceipt ? (
        <Alert
          variant="warning"
          messages={[t('overReceiptWarning'), t('overReceiptToleranceNote')]}
        />
      ) : null}

      {lines.map((line, index) => (
        <GrnLineRow
          key={line.key}
          line={line}
          index={index}
          error={showErrors ? grnLineError(line) : null}
          onPatch={(patch) => update(line.key, patch)}
        />
      ))}
    </div>
  );
}

function GrnLineRow({
  line,
  index,
  error,
  onPatch,
}: {
  line: GrnLineDraft;
  index: number;
  error: GrnLineError | null;
  onPatch: (patch: Partial<GrnLineDraft>) => void;
}) {
  const t = useTranslations('procurement.grn');
  const tc = useTranslations('procurement.common');
  const tQuality = useTranslations('procurement.grn.quality');
  const locale = useLocale() as 'en' | 'ar';

  const ids = {
    received: useId(),
    accepted: useId(),
    rejected: useId(),
    reason: useId(),
    quality: useId(),
  };

  const q = grnLineQuantities(line);
  const touched = !isEmptyGrnLine(q);

  /**
   * Typing a received quantity fills accepted with the same figure, which is the common
   * case — most deliveries are accepted whole. It only autofills while accepted is
   * untouched, so a user who has entered a split does not have it overwritten.
   */
  const onReceivedChange = (received: string) => {
    const shouldMirror = line.accepted === '' || line.accepted === line.received;
    onPatch({ received, ...(shouldMirror ? { accepted: received } : {}) });
  };

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">
        {tc('lineNumber')}
        {index + 1} · {line.description}
      </legend>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="text-sm">
          <span className="block text-xs font-medium text-muted-foreground">
            {t('orderedQuantity')}
          </span>
          <span className="tabular-nums">
            {formatNumber(line.orderedQuantity, locale)} <bdi>{line.uomSymbol}</bdi>
          </span>
        </div>

        <div className="text-sm">
          <span className="block text-xs font-medium text-muted-foreground">
            {t('previouslyReceived')}
          </span>
          <span className="tabular-nums">{formatNumber(line.previouslyReceived, locale)}</span>
        </div>

        <div>
          <label htmlFor={ids.received} className="mb-1 block text-xs font-medium">
            {t('receivedQuantity')}
          </label>
          <Input
            id={ids.received}
            inputMode="decimal"
            value={line.received}
            onChange={(e) => onReceivedChange(e.target.value)}
            className="text-end tabular-nums"
          />
        </div>

        <div>
          <label htmlFor={ids.accepted} className="mb-1 block text-xs font-medium">
            {t('acceptedQuantity')}
          </label>
          <Input
            id={ids.accepted}
            inputMode="decimal"
            value={line.accepted}
            onChange={(e) => onPatch({ accepted: e.target.value })}
            className="text-end tabular-nums"
          />
        </div>

        <div>
          <label htmlFor={ids.rejected} className="mb-1 block text-xs font-medium">
            {t('rejectedQuantity')}
          </label>
          <Input
            id={ids.rejected}
            inputMode="decimal"
            value={line.rejected}
            onChange={(e) => onPatch({ rejected: e.target.value })}
            className="text-end tabular-nums"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={ids.reason} className="mb-1 block text-xs font-medium">
            {t('rejectionReason')} ({tc('optional')})
          </label>
          <Input
            id={ids.reason}
            value={line.rejectionReason}
            onChange={(e) => onPatch({ rejectionReason: e.target.value })}
          />
        </div>

        <div>
          <label htmlFor={ids.quality} className="mb-1 block text-xs font-medium">
            {t('qualityStatus')}
          </label>
          <select
            id={ids.quality}
            value={line.qualityStatus}
            onChange={(e) => onPatch({ qualityStatus: e.target.value as QualityStatus })}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            {SELECTABLE_QUALITY.map((status) => (
              <option key={status} value={status}>
                {tQuality(status)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {touched ? (
        <div className="mt-3">
          <QuantitySplit
            receivedMinor={q.receivedMinor}
            acceptedMinor={q.acceptedMinor}
            rejectedMinor={q.rejectedMinor}
          />
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs font-medium text-danger" role="alert">
          {t(`lineError.${error}`)}
        </p>
      ) : null}
    </fieldset>
  );
}
