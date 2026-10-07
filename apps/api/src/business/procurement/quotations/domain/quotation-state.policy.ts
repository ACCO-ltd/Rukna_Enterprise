/**
 * ADR-044 §3 — the quotation request state machine, as data.
 *
 * Pure: no I/O, never throws. The same function answers both "may this command run?" (the command
 * services turn a blocked answer into a 403/409) and "why can't I?" (the detail read model returns
 * every action with `enabled` + `reasonCode`), so the two can never disagree.
 *
 * Order of the checks, and therefore of the reason a caller sees: permission → state → linked
 * purchase order → segregation of duties → preconditions (quotes present, totals typed).
 */

export type QuotationStatus =
  | 'COLLECTING'
  | 'AWAITING_DECISION'
  | 'RETURNED'
  | 'AWARD_PENDING_APPROVAL'
  | 'AWARDED'
  | 'CANCELLED';

export const QUOTATION_ACTIONS = [
  'ADD_QUOTE',
  'ADD_PAGE',
  'WITHDRAW_QUOTE',
  'SEND',
  'REOPEN',
  'ENTER_TOTAL',
  'REJECT_QUOTE',
  'ASK_ANOTHER',
  'AWARD',
  'WITHDRAW_AWARD',
  'REQUEST_REDECISION',
  'RAISE_ORDER',
  'CANCEL',
] as const;
export type QuotationAction = (typeof QUOTATION_ACTIONS)[number];

/** Why an action is unavailable. SoD blocks carry the rule code instead (see `blockKind`). */
export type QuotationReasonCode =
  | 'MISSING_PERMISSION'
  | 'QUOTATION_CANCELLED'
  | 'QUOTATION_FROZEN'
  | 'QUOTATION_NOT_COLLECTING'
  | 'QUOTATION_NOT_AWAITING_DECISION'
  | 'QUOTATION_NOT_PENDING_APPROVAL'
  | 'QUOTATION_NOT_AWARDED'
  | 'QUOTES_REQUIRED'
  | 'QUOTE_TOTALS_MISSING'
  | 'PURCHASE_ORDER_LIVE'
  | 'PURCHASE_ORDER_CONFIRMED';

/** The purchase order raised from the award, as far as the state machine cares. */
export interface LinkedPurchaseOrderFacts {
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED';
  /** Any revision was ever confirmed (ACTIVE) — a cancelled PO keeps this true. */
  everConfirmed: boolean;
}

export interface QuotationFacts {
  status: QuotationStatus;
  linkedPurchaseOrder: LinkedPurchaseOrderFacts | null;
  activeQuoteCount: number;
  /** ACTIVE quotes without a positive entered total. */
  activeQuotesWithoutTotal: number;
}

export interface CallerFacts {
  canCollect: boolean;
  canAward: boolean;
  canCreatePurchaseOrder: boolean;
  /** The SoD rule code barring this caller from selecting on this request, or null. */
  selectionBarredBy: string | null;
}

export type BlockKind = 'PERMISSION' | 'STATE' | 'SOD' | 'PRECONDITION';

export interface ActionAvailability {
  action: QuotationAction;
  enabled: boolean;
  /** Null when enabled; a QuotationReasonCode, or the SoD rule code when blockKind is SOD. */
  reasonCode: string | null;
  blockKind: BlockKind | null;
}

/** The transition table of ADR-044 §3: from-status → to-status for each command. */
const TRANSITIONS: Record<QuotationAction, Partial<Record<QuotationStatus, QuotationStatus>>> = {
  ADD_QUOTE: { COLLECTING: 'COLLECTING', RETURNED: 'RETURNED' },
  ADD_PAGE: { COLLECTING: 'COLLECTING', RETURNED: 'RETURNED' },
  WITHDRAW_QUOTE: { COLLECTING: 'COLLECTING', RETURNED: 'RETURNED' },
  SEND: { COLLECTING: 'AWAITING_DECISION', RETURNED: 'AWAITING_DECISION' },
  REOPEN: { AWAITING_DECISION: 'COLLECTING' },
  ENTER_TOTAL: { AWAITING_DECISION: 'AWAITING_DECISION' },
  REJECT_QUOTE: { AWAITING_DECISION: 'AWAITING_DECISION' },
  ASK_ANOTHER: { AWAITING_DECISION: 'RETURNED' },
  // A gated proposal parks in AWARD_PENDING_APPROVAL; the re-drive completes it.
  AWARD: { AWAITING_DECISION: 'AWARDED', AWARD_PENDING_APPROVAL: 'AWARDED' },
  WITHDRAW_AWARD: { AWARD_PENDING_APPROVAL: 'AWAITING_DECISION' },
  REQUEST_REDECISION: { AWARDED: 'AWAITING_DECISION' },
  RAISE_ORDER: { AWARDED: 'AWARDED' },
  CANCEL: {
    COLLECTING: 'CANCELLED',
    AWAITING_DECISION: 'CANCELLED',
    RETURNED: 'CANCELLED',
    AWARD_PENDING_APPROVAL: 'CANCELLED',
    AWARDED: 'CANCELLED',
  },
};

/** The status `action` moves a request in `status` to, or null when the table has no such edge. */
export function nextStatus(status: QuotationStatus, action: QuotationAction): QuotationStatus | null {
  return TRANSITIONS[action][status] ?? null;
}

const COLLECT_ACTIONS = new Set<QuotationAction>(['ADD_QUOTE', 'ADD_PAGE', 'WITHDRAW_QUOTE', 'SEND', 'REOPEN']);
const SELECT_ACTIONS = new Set<QuotationAction>(['ENTER_TOTAL', 'REJECT_QUOTE', 'ASK_ANOTHER', 'AWARD', 'WITHDRAW_AWARD']);
/** ADR-044 §6 — the actions SELECT_QUOTATION SoD is evaluated on (withdrawing a proposal is not one). */
const SOD_ACTIONS = new Set<QuotationAction>(['ENTER_TOTAL', 'REJECT_QUOTE', 'ASK_ANOTHER', 'AWARD']);

function hasPermission(action: QuotationAction, caller: CallerFacts): boolean {
  if (COLLECT_ACTIONS.has(action)) return caller.canCollect;
  if (SELECT_ACTIONS.has(action)) return caller.canAward;
  if (action === 'RAISE_ORDER') return caller.canCollect && caller.canCreatePurchaseOrder;
  // REQUEST_REDECISION, CANCEL
  return caller.canCollect || caller.canAward;
}

/** The state-machine reason an action has no edge from `status`. */
function stateReason(action: QuotationAction, status: QuotationStatus): QuotationReasonCode {
  if (status === 'CANCELLED') return 'QUOTATION_CANCELLED';
  switch (action) {
    case 'ADD_QUOTE':
    case 'ADD_PAGE':
    case 'WITHDRAW_QUOTE':
      return 'QUOTATION_FROZEN';
    case 'SEND':
      return 'QUOTATION_NOT_COLLECTING';
    case 'WITHDRAW_AWARD':
      return 'QUOTATION_NOT_PENDING_APPROVAL';
    case 'REQUEST_REDECISION':
    case 'RAISE_ORDER':
      return 'QUOTATION_NOT_AWARDED';
    default:
      return 'QUOTATION_NOT_AWAITING_DECISION';
  }
}

const blocked = (action: QuotationAction, blockKind: BlockKind, reasonCode: string): ActionAvailability => ({
  action,
  enabled: false,
  reasonCode,
  blockKind,
});

export function actionAvailability(
  action: QuotationAction,
  facts: QuotationFacts,
  caller: CallerFacts,
): ActionAvailability {
  if (!hasPermission(action, caller)) return blocked(action, 'PERMISSION', 'MISSING_PERMISSION');
  if (!nextStatus(facts.status, action)) return blocked(action, 'STATE', stateReason(action, facts.status));

  const po = facts.linkedPurchaseOrder;
  const poLive = po !== null && po.status !== 'CANCELLED';
  if (action === 'RAISE_ORDER' || action === 'REQUEST_REDECISION') {
    // The award is spent once an order from it was confirmed (even if that order was later
    // cancelled); a live draft must be cancelled before the award can be re-raised or re-decided.
    if (po?.everConfirmed) return blocked(action, 'STATE', 'PURCHASE_ORDER_CONFIRMED');
    if (poLive) return blocked(action, 'STATE', 'PURCHASE_ORDER_LIVE');
  }
  if (action === 'CANCEL' && facts.status === 'AWARDED' && poLive && po.everConfirmed) {
    return blocked(action, 'STATE', 'PURCHASE_ORDER_CONFIRMED');
  }

  if (SOD_ACTIONS.has(action) && caller.selectionBarredBy) {
    return blocked(action, 'SOD', caller.selectionBarredBy);
  }

  if (action === 'SEND' && facts.activeQuoteCount === 0) {
    return blocked(action, 'PRECONDITION', 'QUOTES_REQUIRED');
  }
  if (
    action === 'AWARD' &&
    facts.status === 'AWAITING_DECISION' &&
    (facts.activeQuoteCount === 0 || facts.activeQuotesWithoutTotal > 0)
  ) {
    return blocked(action, 'PRECONDITION', 'QUOTE_TOTALS_MISSING');
  }

  return { action, enabled: true, reasonCode: null, blockKind: null };
}

/** Every action with its availability — the detail read model's `allowedActions`. */
export function allowedActions(facts: QuotationFacts, caller: CallerFacts): ActionAvailability[] {
  return QUOTATION_ACTIONS.map((action) => actionAvailability(action, facts, caller));
}
