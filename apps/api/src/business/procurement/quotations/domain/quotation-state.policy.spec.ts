import {
  actionAvailability,
  allowedActions,
  nextStatus,
  QUOTATION_ACTIONS,
  type CallerFacts,
  type QuotationAction,
  type QuotationFacts,
  type QuotationStatus,
} from './quotation-state.policy.js';

const STATUSES: QuotationStatus[] = [
  'COLLECTING',
  'AWAITING_DECISION',
  'RETURNED',
  'AWARD_PENDING_APPROVAL',
  'AWARDED',
  'CANCELLED',
];

/** ADR-044 §3 — the full transition table: every (status, action) pair that has an edge. */
const EXPECTED: Record<QuotationAction, Partial<Record<QuotationStatus, QuotationStatus>>> = {
  ADD_QUOTE: { COLLECTING: 'COLLECTING', RETURNED: 'RETURNED' },
  ADD_PAGE: { COLLECTING: 'COLLECTING', RETURNED: 'RETURNED' },
  WITHDRAW_QUOTE: { COLLECTING: 'COLLECTING', RETURNED: 'RETURNED' },
  SEND: { COLLECTING: 'AWAITING_DECISION', RETURNED: 'AWAITING_DECISION' },
  REOPEN: { AWAITING_DECISION: 'COLLECTING' },
  ENTER_TOTAL: { AWAITING_DECISION: 'AWAITING_DECISION' },
  REJECT_QUOTE: { AWAITING_DECISION: 'AWAITING_DECISION' },
  ASK_ANOTHER: { AWAITING_DECISION: 'RETURNED' },
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

const everyone: CallerFacts = {
  canCollect: true,
  canAward: true,
  canCreatePurchaseOrder: true,
  selectionBarredBy: null,
};
const facts = (status: QuotationStatus, extra: Partial<QuotationFacts> = {}): QuotationFacts => ({
  status,
  linkedPurchaseOrder: null,
  activeQuoteCount: 3,
  activeQuotesWithoutTotal: 0,
  ...extra,
});

describe('quotation state policy (ADR-044 §3)', () => {
  describe.each(QUOTATION_ACTIONS)('%s', (action) => {
    it.each(STATUSES)('from %s', (status) => {
      const expected = EXPECTED[action][status] ?? null;
      expect(nextStatus(status, action)).toBe(expected);
      const availability = actionAvailability(action, facts(status), everyone);
      expect(availability.enabled).toBe(expected !== null);
      if (expected === null) expect(availability.blockKind).toBe('STATE');
    });
  });

  it('frozen evidence: add/page/withdraw after send answer QUOTATION_FROZEN', () => {
    for (const status of ['AWAITING_DECISION', 'AWARD_PENDING_APPROVAL', 'AWARDED'] as const) {
      for (const action of ['ADD_QUOTE', 'ADD_PAGE', 'WITHDRAW_QUOTE'] as const) {
        expect(actionAvailability(action, facts(status), everyone).reasonCode).toBe('QUOTATION_FROZEN');
      }
    }
    expect(actionAvailability('ADD_QUOTE', facts('CANCELLED'), everyone).reasonCode).toBe('QUOTATION_CANCELLED');
  });

  it('state reason codes per command family', () => {
    expect(actionAvailability('SEND', facts('AWAITING_DECISION'), everyone).reasonCode).toBe('QUOTATION_NOT_COLLECTING');
    expect(actionAvailability('ENTER_TOTAL', facts('COLLECTING'), everyone).reasonCode).toBe('QUOTATION_NOT_AWAITING_DECISION');
    expect(actionAvailability('WITHDRAW_AWARD', facts('AWAITING_DECISION'), everyone).reasonCode).toBe(
      'QUOTATION_NOT_PENDING_APPROVAL',
    );
    expect(actionAvailability('RAISE_ORDER', facts('AWAITING_DECISION'), everyone).reasonCode).toBe('QUOTATION_NOT_AWARDED');
  });

  it('permissions: collect actions need collect, select actions need award, raise needs both collect and create:purchase-order', () => {
    const collector: CallerFacts = { canCollect: true, canAward: false, canCreatePurchaseOrder: false, selectionBarredBy: null };
    const selector: CallerFacts = { canCollect: false, canAward: true, canCreatePurchaseOrder: false, selectionBarredBy: null };
    expect(actionAvailability('SEND', facts('COLLECTING'), selector).reasonCode).toBe('MISSING_PERMISSION');
    expect(actionAvailability('ENTER_TOTAL', facts('AWAITING_DECISION'), collector).reasonCode).toBe('MISSING_PERMISSION');
    expect(actionAvailability('RAISE_ORDER', facts('AWARDED'), collector).reasonCode).toBe('MISSING_PERMISSION');
    expect(
      actionAvailability('RAISE_ORDER', facts('AWARDED'), { ...collector, canCreatePurchaseOrder: true }).enabled,
    ).toBe(true);
    for (const caller of [collector, selector]) {
      expect(actionAvailability('CANCEL', facts('COLLECTING'), caller).enabled).toBe(true);
      expect(actionAvailability('REQUEST_REDECISION', facts('AWARDED'), caller).enabled).toBe(true);
    }
  });

  it('SoD blocks the selection commands (not withdraw-award) with the rule code', () => {
    const barred = { ...everyone, selectionBarredBy: 'QUOTE_UPLOADER_CANNOT_SELECT' };
    for (const action of ['ENTER_TOTAL', 'REJECT_QUOTE', 'ASK_ANOTHER', 'AWARD'] as const) {
      expect(actionAvailability(action, facts('AWAITING_DECISION'), barred)).toMatchObject({
        enabled: false,
        blockKind: 'SOD',
        reasonCode: 'QUOTE_UPLOADER_CANNOT_SELECT',
      });
    }
    expect(actionAvailability('WITHDRAW_AWARD', facts('AWARD_PENDING_APPROVAL'), barred).enabled).toBe(true);
    expect(actionAvailability('CANCEL', facts('AWAITING_DECISION'), barred).enabled).toBe(true);
  });

  it('preconditions: send needs a quote; award needs every active total', () => {
    expect(actionAvailability('SEND', facts('COLLECTING', { activeQuoteCount: 0 }), everyone).reasonCode).toBe('QUOTES_REQUIRED');
    expect(
      actionAvailability('AWARD', facts('AWAITING_DECISION', { activeQuotesWithoutTotal: 1 }), everyone).reasonCode,
    ).toBe('QUOTE_TOTALS_MISSING');
    // The re-drive of a pending award does not re-ask for totals (evidence is frozen).
    expect(actionAvailability('AWARD', facts('AWARD_PENDING_APPROVAL', { activeQuotesWithoutTotal: 1 }), everyone).enabled).toBe(
      true,
    );
  });

  describe('the linked purchase order', () => {
    const awarded = (po: QuotationFacts['linkedPurchaseOrder']) => facts('AWARDED', { linkedPurchaseOrder: po });

    it('raise / re-decision: allowed with no PO or a never-confirmed cancelled PO', () => {
      for (const action of ['RAISE_ORDER', 'REQUEST_REDECISION'] as const) {
        expect(actionAvailability(action, awarded(null), everyone).enabled).toBe(true);
        expect(actionAvailability(action, awarded({ status: 'CANCELLED', everConfirmed: false }), everyone).enabled).toBe(true);
        expect(actionAvailability(action, awarded({ status: 'DRAFT', everConfirmed: false }), everyone).reasonCode).toBe(
          'PURCHASE_ORDER_LIVE',
        );
        expect(actionAvailability(action, awarded({ status: 'OPEN', everConfirmed: true }), everyone).reasonCode).toBe(
          'PURCHASE_ORDER_CONFIRMED',
        );
        expect(actionAvailability(action, awarded({ status: 'CANCELLED', everConfirmed: true }), everyone).reasonCode).toBe(
          'PURCHASE_ORDER_CONFIRMED',
        );
      }
    });

    it('cancel: refused only while a confirmed PO is live', () => {
      expect(actionAvailability('CANCEL', awarded({ status: 'OPEN', everConfirmed: true }), everyone).reasonCode).toBe(
        'PURCHASE_ORDER_CONFIRMED',
      );
      expect(actionAvailability('CANCEL', awarded({ status: 'CLOSED', everConfirmed: true }), everyone).enabled).toBe(false);
      expect(actionAvailability('CANCEL', awarded({ status: 'DRAFT', everConfirmed: false }), everyone).enabled).toBe(true);
      expect(actionAvailability('CANCEL', awarded({ status: 'CANCELLED', everConfirmed: true }), everyone).enabled).toBe(true);
    });
  });

  it('allowedActions lists every action once, in catalogue order', () => {
    const list = allowedActions(facts('COLLECTING'), everyone);
    expect(list.map((a) => a.action)).toEqual([...QUOTATION_ACTIONS]);
    expect(list.filter((a) => a.enabled).map((a) => a.action)).toEqual(['ADD_QUOTE', 'ADD_PAGE', 'WITHDRAW_QUOTE', 'SEND', 'CANCEL']);
  });
});
