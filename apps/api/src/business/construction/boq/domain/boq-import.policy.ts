/**
 * BOQ bulk import — the plan a spreadsheet becomes, before any of it touches the database.
 *
 * Pure, exactly like `boq-node.policy`: it takes the mapped rows plus the context needed to
 * judge them, and returns a plan of nodes to create alongside two kinds of finding —
 * `violations` that block the whole import (all-or-nothing) and `warnings` that inform but
 * let it proceed. It never reads the database, never generates an id, and never throws; the
 * service (Slice 2) turns violations into a `BadRequestException` and materialises the plan
 * in one transaction.
 *
 * The tree is rebuilt from the dotted codes (Q2): `02.01.003`'s parent is `02.01`, whose
 * parent is `02`. A code that is some other code's prefix is a section (rolls up, carries no
 * pricing); a code with no descendants is a leaf (carries quantity/rate). Ancestors the sheet
 * omitted are synthesised so the tree is always whole. Amounts are recomputed as
 * quantity × unitRate — the sheet's own total column is advisory only (CONST-BOQ-014).
 */

import type {
  BoqImportMode,
  BoqImportRow,
  BoqImportViolation,
  BoqImportViolationCode,
  BoqImportWarning,
  BoqImportWarningCode,
} from '@erp/types';

import { AMOUNT_SCALE, QUANTITY_SCALE, formatAmount, toDecimal, withinScale } from './boq-money.js';
import { MAX_DEPTH } from './boq-node.policy.js';

/** A single import is capped so the one commit transaction stays bounded (Q6). */
export const MAX_IMPORT_ROWS = 5000;

/** A dotted-decimal code: alphanumeric segments joined by single dots, ≤ 50 chars. */
const CODE_PATTERN = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/;

export interface BoqImportContext {
  /** The BOQ's authoritative currency (CONST-BOQ-013); every imported leaf inherits it. */
  boqCurrency: string;
  /**
   * Codes already present in the target version. Consulted only in APPEND mode: a colliding
   * code is a DUPLICATE_CODE, and an ancestor found here is an existing parent, so it is NOT
   * synthesised. Empty on REPLACE (the draft is cleared first) or a fresh draft.
   */
  existingCodes: ReadonlySet<string>;
  /**
   * Units known to the organisation, lower-cased. When supplied, a leaf whose unit is absent
   * warns (UNKNOWN_UNIT) — it never blocks, because `unit` is free text on the node. Omit to
   * skip the check entirely.
   */
  knownUnits?: ReadonlySet<string>;
  mode: BoqImportMode;
}

/**
 * A node the import will create. Ordered parents-before-children; `path` is left to the
 * service, which materialises it from the parent at insert (ids do not exist yet).
 */
export interface PlannedImportNode {
  code: string;
  /** null for a root; otherwise the code of the parent — a planned node or an existing one. */
  parentCode: string | null;
  description: string;
  isLeaf: boolean;
  /** 0-based; the number of dotted segments minus one (a root `02` is depth 0). */
  depth: number;
  /**
   * Dense 0-based order among this node's *planned* siblings, in sheet reading order. In
   * APPEND mode the service offsets it by the count of pre-existing siblings under the parent.
   */
  sortOrder: number;
  unit: string | null;
  quantity: string | null;
  unitRate: string | null;
  currency: string | null;
  totalAmount: string | null;
  /** True when this ancestor section was synthesised because the sheet omitted it. */
  autoCreated: boolean;
}

export interface BoqImportPlan {
  nodes: PlannedImportNode[];
  violations: BoqImportViolation[];
  warnings: BoqImportWarning[];
  /** True when nothing blocks the import — the service may commit. */
  ok: boolean;
}

/** A row that has survived shape validation and carries a usable code. */
interface CleanRow {
  rowNumber: number;
  code: string;
  description: string;
  unit: string | null;
  quantity: string | null;
  unitRate: string | null;
  sheetAmount: string | null;
}

export function planBoqImport(
  rows: readonly BoqImportRow[],
  context: BoqImportContext,
): BoqImportPlan {
  const violations: BoqImportViolation[] = [];
  const warnings: BoqImportWarning[] = [];

  if (rows.length === 0) {
    // Not a violation — an empty sheet simply plans nothing. The service decides whether an
    // empty REPLACE (clearing the draft) is meaningful; the planner stays neutral.
    return { nodes: [], violations, warnings, ok: true };
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    violations.push(
      finding('TOO_MANY_ROWS', null, null, `An import is limited to ${MAX_IMPORT_ROWS} rows; this sheet has ${rows.length}.`),
    );
    return { nodes: [], violations, warnings, ok: false };
  }

  const appending = context.mode === 'APPEND';

  // ── 1. Shape each row and key the survivors by code ──────────────────────────
  const cleanByCode = new Map<string, CleanRow>();
  const seen = new Set<string>();

  for (const row of rows) {
    const code = (row.code ?? '').trim();
    const description = (row.description ?? '').trim();

    if (code.length === 0) {
      violations.push(finding('MISSING_CODE', row.rowNumber, null, 'Row has no item code.'));
      continue;
    }
    if (code.length > 50 || !CODE_PATTERN.test(code)) {
      violations.push(
        finding('INVALID_CODE', row.rowNumber, code, `Code "${code}" must be dotted digits or letters, such as 02.01.003.`),
      );
      continue;
    }
    if (seen.has(code)) {
      violations.push(
        finding('DUPLICATE_CODE', row.rowNumber, code, `Code "${code}" appears more than once in the sheet.`),
      );
      continue;
    }
    if (appending && context.existingCodes.has(code)) {
      violations.push(
        finding('DUPLICATE_CODE', row.rowNumber, code, `Code "${code}" already exists in this version.`),
      );
      continue;
    }
    seen.add(code);

    if (description.length === 0) {
      // Blocks the commit, but the node still takes its place in the tree so every other
      // finding surfaces in the same pass (Q6).
      violations.push(finding('MISSING_DESCRIPTION', row.rowNumber, code, `Row "${code}" has no description.`));
    }

    cleanByCode.set(code, {
      rowNumber: row.rowNumber,
      code,
      description,
      unit: blankToNull(row.unit),
      quantity: blankToNull(row.quantity),
      unitRate: blankToNull(row.unitRate),
      sheetAmount: blankToNull(row.sheetAmount),
    });
  }

  // ── 2. Synthesise every ancestor the sheet omitted ───────────────────────────
  const autoCreated = new Set<string>();
  for (const code of cleanByCode.keys()) {
    let parent = parentOf(code);
    while (
      parent !== null &&
      !cleanByCode.has(parent) &&
      !(appending && context.existingCodes.has(parent))
    ) {
      autoCreated.add(parent);
      parent = parentOf(parent);
    }
  }

  const plannedCodes = new Set<string>([...cleanByCode.keys(), ...autoCreated]);

  // A code is a section when some other planned node hangs off it.
  const hasChild = new Set<string>();
  for (const code of plannedCodes) {
    const parent = parentOf(code);
    if (parent !== null && plannedCodes.has(parent)) hasChild.add(parent);
  }

  // ── 3. Anchor rows drive sibling order (sheet reading order) ──────────────────
  const anchorRow = new Map<string, number>();
  for (const [code, row] of cleanByCode) anchorRow.set(code, row.rowNumber);
  for (const [code, row] of cleanByCode) {
    let parent = parentOf(code);
    while (parent !== null && autoCreated.has(parent)) {
      const current = anchorRow.get(parent);
      if (current === undefined || row.rowNumber < current) anchorRow.set(parent, row.rowNumber);
      parent = parentOf(parent);
    }
  }
  const anchorOf = (code: string): number => anchorRow.get(code) ?? Number.MAX_SAFE_INTEGER;

  // ── 4. Build a node per planned code ─────────────────────────────────────────
  const built = new Map<string, PlannedImportNode>();
  for (const code of plannedCodes) {
    const depth = depthOf(code);
    if (depth > MAX_DEPTH) {
      const at = cleanByCode.get(code)?.rowNumber ?? null;
      violations.push(
        finding('MAX_DEPTH_EXCEEDED', at, code, `Code "${code}" is ${depth + 1} levels deep; the limit is ${MAX_DEPTH + 1}.`),
      );
    }

    const parent = parentOf(code);
    const parentCode = parent !== null && (plannedCodes.has(parent) || context.existingCodes.has(parent)) ? parent : null;
    const isSection = hasChild.has(code);
    const clean = cleanByCode.get(code);

    if (clean === undefined) {
      // Auto-created ancestor: a section named after its code until someone renames it.
      warnings.push(warn('AUTO_CREATED_SECTION', null, code, `Section "${code}" was added because the sheet skipped it.`));
      built.set(code, sectionNode(code, parentCode, code, depth, true));
      continue;
    }

    if (isSection) {
      if (clean.unit !== null || clean.quantity !== null || clean.unitRate !== null) {
        warnings.push(
          warn('SECTION_CARRIES_PRICING', clean.rowNumber, code, `"${code}" has sub-items, so it is a section; its unit/quantity/rate were dropped.`),
        );
      }
      built.set(code, sectionNode(code, parentCode, clean.description, depth, false));
      continue;
    }

    // A leaf: validate pricing, recompute the amount, and flag the soft cases.
    validateLeafPricing(clean, violations);
    if (clean.unitRate === null) {
      warnings.push(warn('UNPRICED_ITEM', clean.rowNumber, code, `Item "${code}" has no rate; it imports unpriced.`));
    }
    if (
      context.knownUnits !== undefined &&
      clean.unit !== null &&
      !context.knownUnits.has(clean.unit.toLowerCase())
    ) {
      warnings.push(warn('UNKNOWN_UNIT', clean.rowNumber, code, `Unit "${clean.unit}" on "${code}" is not in your units registry.`));
    }
    flagAmountMismatch(clean, warnings);

    const quantityDecimal = clean.quantity === null ? null : safeDecimal(clean.quantity);
    const rateDecimal = clean.unitRate === null ? null : safeDecimal(clean.unitRate);
    const totalAmount =
      quantityDecimal !== null && rateDecimal !== null
        ? formatAmount(quantityDecimal.mul(rateDecimal).toDecimalPlaces(AMOUNT_SCALE))
        : null;
    built.set(code, {
      code,
      parentCode,
      description: clean.description,
      isLeaf: true,
      depth,
      sortOrder: 0,
      unit: clean.unit,
      quantity: clean.quantity,
      unitRate: clean.unitRate,
      currency: context.boqCurrency,
      totalAmount,
      autoCreated: false,
    });
  }

  // ── 5. Dense sibling order, then parents-before-children for insert ──────────
  const siblings = new Map<string, PlannedImportNode[]>();
  for (const node of built.values()) {
    const key = node.parentCode ?? ' root';
    let group = siblings.get(key);
    if (group === undefined) {
      group = [];
      siblings.set(key, group);
    }
    group.push(node);
  }
  for (const group of siblings.values()) {
    group.sort((a, b) => anchorOf(a.code) - anchorOf(b.code) || compareCode(a.code, b.code));
    group.forEach((node, index) => {
      node.sortOrder = index;
    });
  }

  const nodes = [...built.values()].sort(
    (a, b) => a.depth - b.depth || anchorOf(a.code) - anchorOf(b.code) || compareCode(a.code, b.code),
  );

  return { nodes, violations, warnings, ok: violations.length === 0 };
}

// ─── helpers ────────────────────────────────────────────────────────────────────

function parentOf(code: string): string | null {
  const dot = code.lastIndexOf('.');
  return dot === -1 ? null : code.slice(0, dot);
}

function depthOf(code: string): number {
  return code.split('.').length - 1;
}

function compareCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function sectionNode(
  code: string,
  parentCode: string | null,
  description: string,
  depth: number,
  autoCreated: boolean,
): PlannedImportNode {
  return {
    code,
    parentCode,
    description,
    isLeaf: false,
    depth,
    sortOrder: 0,
    unit: null,
    quantity: null,
    unitRate: null,
    currency: null,
    totalAmount: null,
    autoCreated,
  };
}

/**
 * Parses a decimal without trusting the input. `boq-money.toDecimal` *throws* on a string
 * decimal.js cannot read (e.g. "ten", "1,000") — it was only ever fed DTO-validated values.
 * An import carries raw sheet cells, so the throw is swallowed and reported as a violation.
 */
function safeDecimal(value: string): ReturnType<typeof toDecimal> {
  try {
    return toDecimal(value);
  } catch {
    return null;
  }
}

function validateLeafPricing(row: CleanRow, violations: BoqImportViolation[]): void {
  if (row.quantity !== null) {
    const quantity = safeDecimal(row.quantity);
    if (quantity === null) {
      violations.push(finding('NON_NUMERIC_QUANTITY', row.rowNumber, row.code, `Quantity "${row.quantity}" on "${row.code}" is not a number.`));
    } else {
      if (quantity.isNegative()) {
        violations.push(finding('NEGATIVE_QUANTITY', row.rowNumber, row.code, `Quantity on "${row.code}" cannot be negative.`));
      }
      if (!withinScale(quantity, QUANTITY_SCALE)) {
        violations.push(finding('QUANTITY_SCALE', row.rowNumber, row.code, `Quantity on "${row.code}" supports at most ${QUANTITY_SCALE} decimal places.`));
      }
    }
  }

  if (row.unitRate !== null) {
    const rate = safeDecimal(row.unitRate);
    if (rate === null) {
      violations.push(finding('NON_NUMERIC_RATE', row.rowNumber, row.code, `Rate "${row.unitRate}" on "${row.code}" is not a number.`));
    } else {
      if (rate.isNegative()) {
        violations.push(finding('NEGATIVE_RATE', row.rowNumber, row.code, `Rate on "${row.code}" cannot be negative.`));
      }
      if (!withinScale(rate, AMOUNT_SCALE)) {
        violations.push(finding('RATE_SCALE', row.rowNumber, row.code, `Rate on "${row.code}" supports at most ${AMOUNT_SCALE} decimal places.`));
      }
    }
  }
}

function flagAmountMismatch(row: CleanRow, warnings: BoqImportWarning[]): void {
  if (row.sheetAmount === null || row.quantity === null || row.unitRate === null) return;
  const sheet = safeDecimal(row.sheetAmount);
  const quantity = safeDecimal(row.quantity);
  const rate = safeDecimal(row.unitRate);
  if (sheet === null || quantity === null || rate === null) return;
  const computed = quantity.mul(rate).toDecimalPlaces(AMOUNT_SCALE);
  if (!sheet.toDecimalPlaces(AMOUNT_SCALE).equals(computed)) {
    warnings.push(
      warn('AMOUNT_MISMATCH', row.rowNumber, row.code, `Sheet amount ${sheet.toFixed(AMOUNT_SCALE)} on "${row.code}" ≠ quantity × rate ${computed.toFixed(AMOUNT_SCALE)}; the computed value is stored.`),
    );
  }
}

function finding(
  code: BoqImportViolationCode,
  rowNumber: number | null,
  nodeCode: string | null,
  message: string,
): BoqImportViolation {
  return { code, rowNumber, nodeCode, message };
}

function warn(
  code: BoqImportWarningCode,
  rowNumber: number | null,
  nodeCode: string | null,
  message: string,
): BoqImportWarning {
  return { code, rowNumber, nodeCode, message };
}
