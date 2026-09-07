import type { ProjectProcurementCostResponse } from '@erp/types';

/**
 * Cost breakdown export.
 *
 * CSV, for the same reason the BOQ export is CSV: no spreadsheet library is installed, and
 * adding one to emit a file ACCO will reformat anyway is the wrong trade. BOM-prefixed so it
 * opens directly in Excel.
 *
 * It exports **the view the reader is looking at** — the same dimension, the same rows, the
 * same figures. An export that quietly returns something else is worse than no export, because
 * the difference only surfaces once the numbers are in a meeting.
 *
 * Money is written as the raw decimal string, not the formatted display value: a spreadsheet
 * needs a number, and `$990,000.00` is text.
 */

export interface CostExportHeaders {
  costArea: string;
  category: string;
  supplier: string;
  budget: string;
  openCommitment: string;
  accrued: string;
  actual: string;
  uncommitted: string;
}

/** Escapes one CSV field, neutralising anything a spreadsheet would treat as a formula. */
function field(value: string | null | undefined): string {
  const text = value ?? '';
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Indents a BOQ row by its depth so the exported file keeps the hierarchy readable. */
function indented(depth: number, code: string | null, description: string): string {
  return `${'    '.repeat(depth)}${code ? `${code} · ` : ''}${description}`;
}

export function buildCostCsv(
  data: ProjectProcurementCostResponse,
  dimension: 'boq' | 'category' | 'supplier',
  headers: CostExportHeaders,
): string {
  const rows: string[][] = [];

  if (dimension === 'boq') {
    rows.push([
      headers.costArea,
      headers.budget,
      headers.openCommitment,
      headers.accrued,
      headers.actual,
      headers.uncommitted,
    ]);
    for (const row of data.byBoq) {
      rows.push([
        indented(row.depth, row.code, row.description),
        row.budget ?? '',
        row.committed ?? '',
        row.accrued ?? '',
        row.actual ?? '',
        row.uncommittedBudget ?? '',
      ]);
    }
  } else if (dimension === 'category') {
    rows.push([headers.category, headers.openCommitment, headers.accrued, headers.actual]);
    for (const row of data.byCategory) {
      rows.push([row.categoryName, row.committed ?? '', row.accrued ?? '', row.actual ?? '']);
    }
  } else {
    rows.push([headers.supplier, headers.openCommitment, headers.accrued, headers.actual]);
    for (const row of data.bySupplier) {
      rows.push([row.supplierName, row.committed ?? '', row.accrued ?? '', row.actual ?? '']);
    }
  }

  return rows.map((r) => r.map(field).join(',')).join('\r\n');
}

/** Writes the CSV to a file the browser downloads. The only DOM work in this module. */
export function downloadCostCsv(
  data: ProjectProcurementCostResponse,
  dimension: 'boq' | 'category' | 'supplier',
  headers: CostExportHeaders,
): void {
  const csv = buildCostCsv(data, dimension, headers);
  // The BOM is what makes Excel read it as UTF-8 rather than the system codepage.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `project-cost-${dimension}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
