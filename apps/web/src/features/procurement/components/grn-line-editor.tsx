'use client';

/**
 * Goods receipt line editor — Round 2, acceptance-by-default (D5).
 *
 * The product owner's locked model: a normal delivery is accepted whole, and quality
 * accounting is never forced onto a clean receipt. Each line is a stacked block that shows
 * Ordered / Previously received / Remaining, one **Received now** input, and a
 * **No issues / Report discrepancy** toggle that defaults to "No issues".
 *
 *  - **No issues** (`mode: 'clean'`): the only writable field is Received now. `accepted`
 *    equals `received` and `rejected` is `0`; the accepted/rejected/reason/quality/notes
 *    fields are not rendered at all. The payload the parent builds sends `qualityStatus:
 *    'ACCEPTED'` and no rejection.
 *  - **Report discrepancy** (`mode: 'discrepancy'`): the line expands to Accepted / Rejected
 *    / Reason / Quality / Notes, with the live constraint **accepted + rejected === received**
 *    checked before submit (Rule GRN split; the server enforces it too).
 *
 * Three server behaviours still shape this, all from the Sprint-5 sweep:
 *
 *  1. `receivedQuantity` and `acceptedQuantity` are `@IsPositive()` (P6). §12.7 pre-populates
 *     one row per PO line, but a partial delivery leaves untouched rows at zero and the
 *     validator refuses the whole request — so untouched rows are dropped from the payload,
 *     not sent as zeros. `submittableGrnLines` / `isEmptyGrnLine` decide which. The same
 *     validator makes a wholly rejected line impossible, so `REJECTED` is not offered and an
 *     `accepted = 0` split is blocked with an explanation rather than an unexplained 400.
 *  2. The over-receipt tolerance is not knowable to the client (P9). It is resolved per org
 *     and spend category from an `OverReceiptPolicy` no endpoint exposes, falling back to 5%.
 *     So the inline flag never quotes a percentage — it says the delivery exceeds the
 *     remaining balance by N and will be flagged for review, which is honest whatever the
 *     policy is. The client never caps the value (A1): the true received quantity is sent and
 *     the server decides EXCEPTION_PENDING.
 *  3. Material and description are inherited read-only from the PO line (D7), never re-picked.
 */

import { useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Alert, Input, Select, Textarea, ViewSwitcher } from '@erp/ui';

import { formatNumber } from '@/lib/format';
import { QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import {
  isEmptyGrnLine,
  overReceiptState,
  validateGrnLine,
  type GrnLineError,
  type OverReceiptState,
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

/** Per-line acceptance mode. Clean is the default and the common case. */
export type GrnLineMode = 'clean' | 'discrepancy';

export interface GrnLineDraft {
  key: string;
  purchaseOrderLineId: string;
  /** Inherited read-only from the PO line (D7). */
  materialCode: string | null;
  description: string;
  uomSymbol: string;
  orderedQuantity: string;
  previouslyReceived: string;
  received: string;
  /** Discrepancy-only fields — ignored while `mode === 'clean'`. */
  mode: GrnLineMode;
  accepted: string;
  rejected: string;
  rejectionReason: string;
  qualityStatus: QualityStatus;
  notes: string;
}

/** One draft row per ACTIVE-revision PO line, as §12.7 specifies. Every row starts clean. */
export function grnLinesFromPo(
  lines: readonly PurchaseOrderLine[],
  previouslyReceivedByLineId: Record<string, string> = {},
): GrnLineDraft[] {
  return lines.map((line) => ({
    key: line.id,
    purchaseOrderLineId: line.id,
    materialCode: line.material?.code ?? null,
    description: line.description,
    uomSymbol: line.uom?.symbol ?? line.uom?.code ?? '',
    orderedQuantity: line.orderedQuantity,
    previouslyReceived: previouslyReceivedByLineId[line.id] ?? '0',
    received: '',
    mode: 'clean',
    accepted: '',
    rejected: '',
    rejectionReason: '',
    qualityStatus: 'ACCEPTED',
    notes: '',
  }));
}

/**
 * The quantities a line resolves to, in minor units.
 *
 * In clean mode accepted mirrors received and rejected is zero — the acceptance-by-default
 * rule lives here, so the components and the payload builder never re-derive it. In
 * discrepancy mode the split is read from the fields the user filled in.
 */
export function grnLineQuantities(line: GrnLineDraft) {
  const receivedMinor = parseMinorUnits(line.received, QUANTITY_SCALE) ?? 0;
  if (line.mode === 'clean') {
    return { receivedMinor, acceptedMinor: receivedMinor, rejectedMinor: 0 };
  }
  return {
    receivedMinor,
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('emptyLinesHint')}</p>

      {lines.map((line) => (
        <GrnLineRow
          key={line.key}
          line={line}
          error={showErrors ? grnLineError(line) : null}
          onPatch={(patch) => update(line.key, patch)}
        />
      ))}
    </div>
  );
}

function GrnLineRow({
  line,
  error,
  onPatch,
}: {
  line: GrnLineDraft;
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
    notes: useId(),
  };

  const q = grnLineQuantities(line);
  const touched = !isEmptyGrnLine(q);

  const orderedMinor = parseMinorUnits(line.orderedQuantity, QUANTITY_SCALE) ?? 0;
  const previouslyMinor = parseMinorUnits(line.previouslyReceived, QUANTITY_SCALE) ?? 0;
  const remainingMinor = Math.max(orderedMinor - previouslyMinor, 0);
  const showNumber = (minor: number) =>
    formatNumber(fromMinorUnits(minor, QUANTITY_SCALE), locale) ?? '0';

  const over = overReceiptState(orderedMinor, previouslyMinor, q.receivedMinor);

  const modeItems = [
    { value: 'clean', label: t('noIssues') },
    { value: 'discrepancy', label: t('reportDiscrepancy') },
  ];

  return (
    <div className="rounded-lg border border-border p-4">
      {/* D7: material + description, inherited read-only from the PO line. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {line.materialCode ? (
          <span className="font-mono text-xs text-muted-foreground">{line.materialCode}</span>
        ) : null}
        <span className="text-sm font-medium text-foreground">{line.description}</span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {t('orderedQuantity')} <span className="tabular-nums text-foreground">{showNumber(orderedMinor)}</span>
        {' · '}
        {t('previouslyReceived')}{' '}
        <span className="tabular-nums text-foreground">{showNumber(previouslyMinor)}</span>
        {' · '}
        {t('remaining')} <span className="tabular-nums text-foreground">{showNumber(remainingMinor)}</span>
        {line.uomSymbol ? (
          <>
            {' '}
            <bdi>{line.uomSymbol}</bdi>
          </>
        ) : null}
      </p>

      {/* Received now + the acceptance toggle. On a narrow viewport these stack. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:max-w-[10rem]">
          <label htmlFor={ids.received} className="mb-1 block text-xs font-medium">
            {t('receivedNow')}
          </label>
          <Input
            id={ids.received}
            inputMode="decimal"
            value={line.received}
            onChange={(e) => onPatch({ received: e.target.value })}
            className="text-end tabular-nums"
          />
        </div>

        <ViewSwitcher
          aria-label={t('acceptanceModeLabel', { description: line.description })}
          items={modeItems}
          value={line.mode}
          onValueChange={(value) => onPatch({ mode: value as GrnLineMode })}
        />
      </div>

      {/* A1: never cap the value. Flag over-receipt honestly; the server decides the outcome. */}
      {over.state !== 'within' ? (
        <OverReceiptFlag
          state={over.state}
          overBy={showNumber(over.overByMinor)}
          uomSymbol={line.uomSymbol}
        />
      ) : null}

      {/* Discrepancy disclosure — the accepted/rejected split and quality accounting. */}
      {line.mode === 'discrepancy' ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
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

            <div>
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
              <Select
                id={ids.quality}
                value={line.qualityStatus}
                onChange={(e) => onPatch({ qualityStatus: e.target.value as QualityStatus })}
              >
                {SELECTABLE_QUALITY.map((status) => (
                  <option key={status} value={status}>
                    {tQuality(status)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label htmlFor={ids.notes} className="mb-1 block text-xs font-medium">
              {tc('notes')} ({tc('optional')})
            </label>
            <Textarea
              id={ids.notes}
              rows={2}
              value={line.notes}
              onChange={(e) => onPatch({ notes: e.target.value })}
            />
          </div>

          {touched ? (
            <QuantitySplit
              receivedMinor={q.receivedMinor}
              acceptedMinor={q.acceptedMinor}
              rejectedMinor={q.rejectedMinor}
            />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs font-medium text-danger" role="alert">
          {t(`lineError.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The inline over-receipt flag (A1). Two tones, both policy-honest:
 *
 *  - `tolerated` — within the assumed tolerance: a warning that the delivery exceeds the
 *    remaining balance but should still post.
 *  - `exception` — beyond it: a stronger notice that the receipt will be held for review and
 *    cannot be posted until a supervisor clears it.
 *
 * Neither quotes a percentage; the tolerance is a server policy the client cannot read (P9).
 */
function OverReceiptFlag({
  state,
  overBy,
  uomSymbol,
}: {
  state: Exclude<OverReceiptState, 'within'>;
  overBy: string;
  uomSymbol: string;
}) {
  const t = useTranslations('procurement.grn');
  const amount = uomSymbol ? `${overBy} ${uomSymbol}` : overBy;

  return (
    <div className="mt-3">
      <Alert
        variant="warning"
        messages={
          state === 'exception'
            ? [t('overReceiptExceptionFlag', { amount }), t('overReceiptToleranceNote')]
            : [t('overReceiptToleratedFlag', { amount }), t('overReceiptToleranceNote')]
        }
      />
    </div>
  );
}
