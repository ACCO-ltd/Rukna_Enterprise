import type { ClientInvoice } from './types';

/**
 * ─── What a client invoice will let you do ──────────────────────────────────────
 *
 * The server is the authority; this exists so the UI offers only actions that will succeed,
 * rather than presenting buttons that answer 400. Same role as `project-actions.ts` and
 * `contract-actions.ts`, and each rule below names the guard it mirrors.
 *
 * The lifecycle is shorter than a supplier bill's. There is no SUBMITTED step, no REJECTED,
 * and nothing returns an invoice to DRAFT — approval is one-way, and the only exit from a
 * posted invoice is a reversal.
 *
 *   DRAFT ──approve──▶ APPROVED ──post──▶ (POSTED) ──reverse──▶ (REVERSED)
 *
 * The parenthesised states are on `postingStatus`, not `documentStatus`. The two axes advance
 * independently, which is why no single status drives this.
 */

export type InvoiceAction = 'approve' | 'post' | 'reverse';

/**
 * Why an action is unavailable, when the reason is worth telling the user.
 *
 * `already-reversed` and `not-posted` are distinct on purpose: both hide Reverse, but only one
 * of them means the invoice is finished.
 */
export type InvoiceBlockReason =
  | 'not-draft'
  | 'not-approved'
  | 'already-posted'
  | 'not-posted'
  | 'already-reversed'
  | 'cancelled';

/**
 * `client-invoice.service.ts:109` — approve requires DRAFT and nothing else.
 * An APPROVED or CANCELLED invoice answers 400 with "Invoice is already X".
 */
export function canApprove(invoice: ClientInvoice): boolean {
  return invoice.documentStatus === 'DRAFT';
}

/**
 * Posting statuses from which posting is safe.
 *
 * NOT_POSTED is the first attempt. FAILED is a retry: the engine records `lastPostingErrorCode`
 * and leaves the document APPROVED, so posting again is the intended path.
 *
 * PENDING is excluded — a post is already in flight, and offering the button invites a double
 * post. REVERSED and OPENING_BALANCE are excluded for the reason below.
 */
const POSTABLE_STATUSES: readonly ClientInvoice['postingStatus'][] = ['NOT_POSTED', 'FAILED'];

/**
 * `client-invoice.service.ts:126,129` — the server requires documentStatus APPROVED and answers
 * 409 only when postingStatus is already POSTED.
 *
 * ⚠ **This gate is deliberately stricter than the server**, in the same way `canPostBill` is
 * for supplier bills (P15). Reversing an invoice leaves `documentStatus: 'APPROVED'` and
 * `postingStatus: 'REVERSED'`, which passes the server's guard — so the API will re-post a
 * reversed invoice. `client-invoice.repository.ts:84-93` then overwrites `invoiceNumber` with a
 * fresh number from the sequence and replaces `postedJournalEntryId`, orphaning the original
 * journal while `reversalJournalEntryId` still points at the reversal of it. The audit trail
 * breaks and a number already sent to a client silently changes.
 *
 * OPENING_BALANCE is excluded for the same class of reason: a migrated invoice's GL effect is
 * already carried by the aggregate opening journal, so posting it would double-count.
 *
 * Do not relax this to match the server. Raised for Abdulsalam alongside the AR findings.
 */
export function canPost(invoice: ClientInvoice): boolean {
  return (
    invoice.documentStatus === 'APPROVED' && POSTABLE_STATUSES.includes(invoice.postingStatus)
  );
}

/**
 * `client-invoice.service.ts:239,242` — reverse requires postingStatus POSTED and no existing
 * reversal journal.
 *
 * There is a third server guard this cannot mirror: reversal is refused while the invoice has
 * active receipt allocations. Allocations are not on the invoice payload, so the UI cannot see
 * them and Reverse stays offered — the 400 is surfaced as a message rather than pre-empted.
 * When AR receipts are built, this is the first thing to revisit.
 */
export function canReverse(invoice: ClientInvoice): boolean {
  return invoice.postingStatus === 'POSTED' && invoice.reversalJournalEntryId === null;
}

/** Every action currently legal, in the order they appear in the lifecycle. */
export function availableInvoiceActions(invoice: ClientInvoice): InvoiceAction[] {
  const actions: InvoiceAction[] = [];
  if (canApprove(invoice)) actions.push('approve');
  if (canPost(invoice)) actions.push('post');
  if (canReverse(invoice)) actions.push('reverse');
  return actions;
}

/**
 * Why `action` is unavailable, or `null` when it is available.
 *
 * Used for the disabled-button tooltip. A button that is simply absent tells the user nothing
 * about what to do next; "approve this invoice first" does.
 */
export function invoiceBlockReason(
  invoice: ClientInvoice,
  action: InvoiceAction,
): InvoiceBlockReason | null {
  if (invoice.documentStatus === 'CANCELLED') return 'cancelled';

  switch (action) {
    case 'approve':
      return canApprove(invoice) ? null : 'not-draft';

    case 'post':
      if (canPost(invoice)) return null;
      return invoice.postingStatus === 'POSTED' ? 'already-posted' : 'not-approved';

    case 'reverse':
      if (canReverse(invoice)) return null;
      return invoice.reversalJournalEntryId !== null ? 'already-reversed' : 'not-posted';
  }
}

/**
 * Whether an effective IPC can still raise an invoice.
 *
 * `generateFromIpc` enforces one invoice per IPC (`client-invoice.service.ts:61`) and refuses
 * an IPC that is not effective (`:74`). Both are 4xx, so the billing card checks them first and
 * shows the existing invoice instead of an action.
 */
export function canGenerateInvoice(
  ipc: { isEffective: boolean },
  existingInvoice: ClientInvoice | null,
): boolean {
  return ipc.isEffective && existingInvoice === null;
}

/**
 * The default due date the generate form opens on: 30 days after the invoice date.
 *
 * Purely a starting value — the user edits it, and the server accepts any date. Computed on the
 * date parts rather than through a Date object so a timezone west of UTC cannot roll it back a
 * day, which is how an invoice ends up due before it is issued.
 */
export function defaultDueDate(invoiceDate: string, days = 30): string {
  const [y, m, d] = invoiceDate.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return invoiceDate;

  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}
