import type { DocumentReadingKind, ReadLine } from '@erp/types';

/**
 * Step 7 — what the photo reader asks for, and how its answer is read. Pure.
 *
 * The model is asked for one JSON object and nothing else. Its answer is then read defensively:
 * a model may wrap JSON in prose or code fences, write "1,200.00" or 1200, or invent fields. Only
 * the known fields survive, numbers become plain decimal strings, and anything unreadable becomes
 * null rather than a guess — the person confirming the form is the safety, and a wrong pre-fill is
 * worse than an empty one.
 */

const WHAT: Record<DocumentReadingKind, string> = {
  DELIVERY_NOTE: 'a supplier delivery note (goods delivered to a site). Quantities matter most; prices are usually absent.',
  RECEIPT: 'a purchase receipt or supplier invoice. The total, tax and supplier matter most.',
  QUOTE: 'a supplier price quotation. Each line\'s price and the total matter most.',
  MATERIAL_LIST: 'a list of materials someone needs (often handwritten). Only the items, quantities and units matter.',
};

export function readerPrompt(kind: DocumentReadingKind): string {
  return [
    `The image is ${WHAT[kind]}`,
    'Read it and answer with ONE JSON object and nothing else, using exactly these keys:',
    '{"supplierName": string|null, "documentNumber": string|null, "date": "YYYY-MM-DD"|null, "currency": "ISO 4217 code"|null,',
    ' "total": number|null, "taxAmount": number|null,',
    ' "lines": [{"description": string, "quantity": number|null, "unit": string|null, "unitPrice": number|null, "amount": number|null}]}',
    'Rules: copy text as written; use null for anything you cannot read clearly; never estimate or calculate a value',
    'that is not printed; numbers without thousands separators; one entry in "lines" per item row, in order.',
  ].join('\n');
}

export interface ParsedReading {
  supplierName: string | null;
  documentNumber: string | null;
  date: string | null;
  currency: string | null;
  total: string | null;
  taxAmount: string | null;
  lines: ReadLine[];
  warnings: string[];
}

export class UnreadableAnswerError extends Error {}

const MAX_LINES = 200;

/** The first balanced JSON object in the text (the model may add prose or ``` fences). */
function extractObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new UnreadableAnswerError('no JSON object in the answer');
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        throw new UnreadableAnswerError('the JSON in the answer does not parse');
      }
    }
  }
  throw new UnreadableAnswerError('the JSON object in the answer is not closed');
}

function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s.length === 0 || /^(null|n\/a|none|-)$/i.test(s) ? null : s.slice(0, max);
}

/** A number as a plain decimal string, or null. Accepts 1200, "1,200.00", "$1200", "1 200". */
export function decimal(v: unknown): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : null;
  const s = str(v);
  if (!s) return null;
  const body = s.replace(/[\s,]/g, '').replace(/^[A-Za-z$€£]{1,3}/, '').replace(/[A-Za-z$€£]{1,3}$/, '');
  return /^-?\d+(\.\d+)?$/.test(body) ? body.replace(/^(-?)0+(?=\d)/, '$1') : null;
}

function date(v: unknown): string | null {
  const s = str(v, 20);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export function parseReaderAnswer(text: string): ParsedReading {
  const raw = extractObject(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UnreadableAnswerError('the answer is not an object');
  const o = raw as Record<string, unknown>;
  const warnings: string[] = [];

  const lines: ReadLine[] = (Array.isArray(o.lines) ? o.lines : [])
    .slice(0, MAX_LINES)
    .map((l) => (l && typeof l === 'object' ? (l as Record<string, unknown>) : {}))
    .map((l) => ({
      description: str(l.description, 500) ?? '',
      quantity: decimal(l.quantity),
      unit: str(l.unit, 30),
      unitPrice: decimal(l.unitPrice),
      amount: decimal(l.amount),
    }))
    .filter((l) => l.description !== '' || l.quantity !== null || l.amount !== null);

  const currencyText = str(o.currency, 10)?.toUpperCase() ?? null;
  const currency = currencyText && /^[A-Z]{3}$/.test(currencyText) ? currencyText : null;
  const total = decimal(o.total);

  // A cross-check, never a correction: the person sees the disagreement and decides.
  const amounts = lines.map((l) => l.amount);
  if (total !== null && amounts.length > 0 && amounts.every((a) => a !== null)) {
    const sum = amounts.reduce((s, a) => s + Number(a), 0);
    const tax = Number(decimal(o.taxAmount) ?? 0);
    if (Math.abs(sum - Number(total)) > 0.01 && Math.abs(sum + tax - Number(total)) > 0.01) {
      warnings.push('The total does not equal the sum of the lines.');
    }
  }
  for (const [i, l] of lines.entries()) {
    if (l.quantity !== null && l.unitPrice !== null && l.amount !== null && Math.abs(Number(l.quantity) * Number(l.unitPrice) - Number(l.amount)) > 0.01) {
      warnings.push(`Line ${i + 1}: quantity × price does not equal its amount.`);
    }
  }
  if (lines.some((l) => l.description === '')) warnings.push('Some lines have no description.');

  return {
    supplierName: str(o.supplierName),
    documentNumber: str(o.documentNumber, 60),
    date: date(o.date),
    currency,
    total,
    taxAmount: decimal(o.taxAmount),
    lines,
    warnings,
  };
}
