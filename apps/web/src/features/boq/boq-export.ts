import type { BoqCompareResponse, BoqTreeNodeResponse } from '@erp/types';

import { flattenTree } from './boq-rows';

/**
 * BOQ export.
 *
 * CSV rather than a real workbook, and deliberately so: no spreadsheet library is installed,
 * and adding one to emit a file that ACCO will re-format anyway is the wrong trade. A
 * BOM-prefixed CSV opens directly in Excel with Arabic intact.
 *
 * **This is not the Excel interoperability described in ADR-016.** That needs ACCO's real
 * workbook — its column order, its section conventions, its rate columns — and inventing a
 * template before seeing one guarantees rework. Import is not built at all for the same
 * reason; a disabled Import button is worse than no button.
 *
 * Pure: these build strings. The DOM work is in `downloadCsv`.
 */

export interface ExportOptions {
  /** False when the user lacks commercial visibility — rate and amount columns are dropped. */
  includePricing: boolean;
  headers: {
    code: string;
    description: string;
    type: string;
    unit: string;
    quantity: string;
    rate: string;
    amount: string;
    source: string;
    section: string;
    item: string;
  };
}

/**
 * Escapes one CSV field.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with a quote so a spreadsheet treats it as
 * text. A BOQ description is user-entered and a cell that starts with `=` is a formula —
 * that is a CSV injection, and a BOQ export is exactly the kind of file someone forwards.
 */
function escape(value: string | null | undefined): string {
  const raw = value ?? '';
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function toCsv(rows: (string | null)[][]): string {
  // The BOM is what makes Excel read the file as UTF-8; without it Arabic arrives mojibake.
  return '﻿' + rows.map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n';
}

/** The visible version, flattened depth-first so section order is preserved. */
export function treeToCsv(
  nodes: BoqTreeNodeResponse[],
  currency: string,
  options: ExportOptions,
): string {
  const { headers } = options;
  const header = [
    headers.code,
    headers.description,
    headers.type,
    headers.unit,
    headers.quantity,
    ...(options.includePricing
      ? [`${headers.rate} (${currency})`, `${headers.amount} (${currency})`]
      : []),
    headers.source,
  ];

  const rows = flattenTree(nodes).map((node) => [
    node.code,
    node.description,
    node.isLeaf ? headers.item : headers.section,
    node.unit,
    node.quantity,
    ...(options.includePricing ? [node.unitRate, node.computedTotal] : []),
    node.sourceChangeOrderId ?? node.sourceType,
  ]);

  return toCsv([header, ...rows]);
}

export function compareToCsv(
  diff: BoqCompareResponse,
  options: ExportOptions & { changeHeaders: { kind: string; delta: string; percent: string } },
): string {
  const { headers, changeHeaders } = options;
  const header = [
    headers.code,
    headers.description,
    changeHeaders.kind,
    `${headers.quantity} →`,
    `${headers.rate} →`,
    `${headers.amount} →`,
    changeHeaders.delta,
    changeHeaders.percent,
  ];

  const rows = diff.changes.map((change) => [
    change.code,
    change.description,
    change.kinds.join(' / '),
    `${change.oldQuantity ?? ''} → ${change.newQuantity ?? ''}`,
    `${change.oldUnitRate ?? ''} → ${change.newUnitRate ?? ''}`,
    `${change.oldAmount ?? ''} → ${change.newAmount ?? ''}`,
    change.amountDelta,
    change.amountDeltaPercent,
  ]);

  return toCsv([header, ...rows]);
}

/** Hands the browser a file. Revokes the object URL — a leaked blob pins the whole BOQ. */
export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
