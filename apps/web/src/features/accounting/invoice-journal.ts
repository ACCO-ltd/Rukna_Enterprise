import { MONEY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

import { accountName } from './account-display';
import { resolvePostingAccounts, type PostingRole, type Resolution } from './posting-accounts';

import type { Account, ClientInvoice, PostInvoicePayload } from './types';

/**
 * ─── The journal posting an invoice will write ──────────────────────────────────
 *
 * `client-invoice.service.ts:155-186` builds exactly three lines, and never more:
 *
 *   Dr  Accounts Receivable    totalAmount
 *     Cr  Revenue                          subtotal
 *     Cr  Output VAT                       vatAmount    ← only when vatAmount > 0
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
   * Always true for a well-formed invoice, since `total = subtotal + vat` is enforced at
   * creation. Surfaced anyway: if it is ever false the invoice row itself is inconsistent, and
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
  return hasVat(invoice)
    ? ['AR_CONTROL', 'REVENUE', 'VAT_OUTPUT']
    : ['AR_CONTROL', 'REVENUE'];
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
  const revenue = resolved.get('REVENUE')!;
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
    {
      accountCode: revenue.code,
      accountName: accountName(revenue, locale),
      debit: null,
      credit: fromMinorUnits(subtotalMinor, MONEY_SCALE),
    },
  ];

  if (vat && vatMinor > 0) {
    lines.push({
      accountCode: vat.code,
      accountName: accountName(vat, locale),
      debit: null,
      credit: fromMinorUnits(vatMinor, MONEY_SCALE),
    });
  }

  const creditMinor = subtotalMinor + (vat ? vatMinor : 0);

  return {
    ok: true,
    plan: {
      lines,
      totalDebit: fromMinorUnits(totalMinor, MONEY_SCALE),
      totalCredit: fromMinorUnits(creditMinor, MONEY_SCALE),
      balanced: totalMinor === creditMinor,
      payload: {
        arAccountCode: ar.code,
        revenueAccountCode: revenue.code,
        ...(vat ? { vatAccountCode: vat.code } : {}),
      },
    },
  };
}
