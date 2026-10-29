import { MONEY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

import { accountName } from './account-display';
import { resolvePostingAccounts, type PostingRole, type Resolution } from './posting-accounts';

import type { Account, ClientInvoice, PostInvoicePayload } from './types';

/**
 * ─── The journal posting an invoice will write ──────────────────────────────────
 *
 * `ClientInvoiceService.post` builds these lines:
 *
 *   Dr  Accounts Receivable    totalAmount              (the amount due)
 *   Dr  Retention Receivable   retentionAmount          ← IPC invoices holding retention (ADR-046 §5)
 *   Dr  Client Advance         advanceRecoveryAmount    ← IPC invoices recovering an advance
 *     Cr  Revenue                          subtotal     ← omitted when 0 (a retention release)
 *     Cr  Output VAT                       vatAmount    ← only when vatAmount > 0
 *     Cr  Retention Receivable             retentionReleasedAmount  ← a retention release invoice
 *
 * The user is shown this before they confirm, because posting is irreversible except by a
 * reversal journal and an accountant should see which accounts are about to move.
 *
 * ─── Why the preview and the payload come from one function ─────────────────────
 *
 * A preview computed separately from the request is a preview that can lie. `planInvoicePost`
 * returns both, from the same resolution, so a screen cannot show one thing and send another.
 * If the two ever need to differ, that is a bug, not a feature.
 *
 * Arithmetic runs in integer minor units. `subtotal + vatAmount` summed as floats is how a
 * preview shows a total a cent away from the invoice it describes.
 */

export interface JournalPreviewLine {
  accountCode: string;
  accountName: string;
  /** Decimal string, or null when this line is on the other side. */
  debit: string | null;
  credit: string | null;
}

export interface InvoicePostPlan {
  lines: JournalPreviewLine[];
  totalDebit: string;
  totalCredit: string;
  /**
   * Always true for a well-formed invoice, since `total + retention + advance recovery =
   * subtotal + vat` is enforced at creation. Surfaced anyway: if it is ever false the invoice row itself is inconsistent, and
   * posting a journal the engine will reject is worse than refusing here.
   */
  balanced: boolean;
  payload: PostInvoicePayload;
}

export type PlanResult =
  | { ok: true; plan: InvoicePostPlan }
  | { ok: false; problems: Extract<Resolution, { ok: false }>[] };

/** True when the invoice carries VAT, and therefore needs a third line and a VAT account. */
export function hasVat(invoice: ClientInvoice): boolean {
  return toMinorUnits(invoice.vatAmount, MONEY_SCALE) > 0;
}

/**
 * The roles this particular invoice needs filled.
 *
 * A zero-VAT invoice does not need a VAT account, and demanding one would block posting on a
 * chart that is perfectly adequate for the invoice in hand.
 */
export function rolesForInvoice(invoice: ClientInvoice): PostingRole[] {
  // ADR-048 — a hand-typed invoice credits each line's own income account, never the revenue role.
  const roles: PostingRole[] = invoice.isManual ? ['AR_CONTROL'] : ['AR_CONTROL', 'REVENUE'];
  if (hasVat(invoice)) roles.push('VAT_OUTPUT');
  if (retentionMinor(invoice) > 0 || retentionReleasedMinor(invoice) > 0) roles.push('RETENTION_RECEIVABLE');
  if (advanceRecoveryMinor(invoice) > 0) roles.push('CLIENT_ADVANCE');
  return roles;
}

/** ADR-046 §5 — retention an IPC invoice holds back, in minor units (0 on other invoices). */
function retentionMinor(invoice: ClientInvoice): number {
  return toMinorUnits(invoice.retentionAmount ?? '0', MONEY_SCALE);
}

/** ADR-046 §5 — retention a release invoice bills, in minor units (0 on other invoices). */
function retentionReleasedMinor(invoice: ClientInvoice): number {
  return toMinorUnits(invoice.retentionReleasedAmount ?? '0', MONEY_SCALE);
}

/** ADR-046 §5 — advance an IPC invoice recovers, in minor units (0 on other invoices). */
function advanceRecoveryMinor(invoice: ClientInvoice): number {
  return toMinorUnits(invoice.advanceRecoveryAmount ?? '0', MONEY_SCALE);
}

/**
 * Resolves the accounts and builds both the preview and the request body.
 *
 * `locale` only affects the names shown; codes and amounts are identical either way.
 */
export function planInvoicePost(
  invoice: ClientInvoice,
  accounts: readonly Account[],
  locale: 'en' | 'ar',
): PlanResult {
  const { resolved, problems } = resolvePostingAccounts(accounts, rolesForInvoice(invoice));
  if (problems.length > 0) return { ok: false, problems };

  const ar = resolved.get('AR_CONTROL')!;
  const revenue = resolved.get('REVENUE') ?? null;
  const vat = resolved.get('VAT_OUTPUT') ?? null;

  const totalMinor = toMinorUnits(invoice.totalAmount, MONEY_SCALE);
  const subtotalMinor = toMinorUnits(invoice.subtotal, MONEY_SCALE);
  const vatMinor = toMinorUnits(invoice.vatAmount, MONEY_SCALE);

  const lines: JournalPreviewLine[] = [
    {
      accountCode: ar.code,
      accountName: accountName(ar, locale),
      debit: fromMinorUnits(totalMinor, MONEY_SCALE),
      credit: null,
    },
  ];
  // ADR-048 — a hand-typed invoice: one credit per income account, in line order, summed as the
  // server sums them (EVT-AR-001 for manual invoices).
  if (invoice.isManual) {
    const byCode = new Map<string, number>();
    for (const line of invoice.lines ?? []) {
      byCode.set(line.revenueAccountCode, (byCode.get(line.revenueAccountCode) ?? 0) + toMinorUnits(line.amount, MONEY_SCALE));
    }
    for (const [code, minor] of byCode) {
      const account = accounts.find((a) => a.code === code);
      lines.push({
        accountCode: code,
        accountName: account ? accountName(account, locale) : code,
        debit: null,
        credit: fromMinorUnits(minor, MONEY_SCALE),
      });
    }
  } else if (revenue && subtotalMinor > 0) {
    // A retention release earns no revenue: no zero-value revenue line, as the server writes it.
    lines.push({
      accountCode: revenue.code,
      accountName: accountName(revenue, locale),
      debit: null,
      credit: fromMinorUnits(subtotalMinor, MONEY_SCALE),
    });
  }

  if (vat && vatMinor > 0) {
    lines.push({
      accountCode: vat.code,
      accountName: accountName(vat, locale),
      debit: null,
      credit: fromMinorUnits(vatMinor, MONEY_SCALE),
    });
  }

  // Retention and advance recovery debits sit after the AR line, as the server writes them.
  const holdBackLines: JournalPreviewLine[] = [];
  let heldBackMinor = 0;
  for (const [role, minor] of [
    ['RETENTION_RECEIVABLE', retentionMinor(invoice)],
    ['CLIENT_ADVANCE', advanceRecoveryMinor(invoice)],
  ] as const) {
    const account = resolved.get(role);
    if (!account || minor <= 0) continue;
    heldBackMinor += minor;
    holdBackLines.push({
      accountCode: account.code,
      accountName: accountName(account, locale),
      debit: fromMinorUnits(minor, MONEY_SCALE),
      credit: null,
    });
  }
  lines.splice(1, 0, ...holdBackLines);

  // A retention release invoice moves its retention out of Retention Receivable.
  const releasedMinor = retentionReleasedMinor(invoice);
  const releasedFrom = resolved.get('RETENTION_RECEIVABLE');
  if (releasedFrom && releasedMinor > 0) {
    lines.push({
      accountCode: releasedFrom.code,
      accountName: accountName(releasedFrom, locale),
      debit: null,
      credit: fromMinorUnits(releasedMinor, MONEY_SCALE),
    });
  }

  const debitMinor = totalMinor + heldBackMinor;
  const revenueMinor = invoice.isManual
    ? (invoice.lines ?? []).reduce((sum, line) => sum + toMinorUnits(line.amount, MONEY_SCALE), 0)
    : subtotalMinor;
  const creditMinor = revenueMinor + (vat ? vatMinor : 0) + (releasedFrom ? releasedMinor : 0);

  return {
    ok: true,
    plan: {
      lines,
      totalDebit: fromMinorUnits(debitMinor, MONEY_SCALE),
      totalCredit: fromMinorUnits(creditMinor, MONEY_SCALE),
      balanced: debitMinor === creditMinor,
      payload: {
        arAccountCode: ar.code,
        ...(revenue && !invoice.isManual ? { revenueAccountCode: revenue.code } : {}),
        ...(vat ? { vatAccountCode: vat.code } : {}),
      },
    },
  };
}
