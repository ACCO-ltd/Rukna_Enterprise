import { Decimal } from '@prisma/client/runtime/library';

import {
  advanceOutstanding,
  applicationAmount,
  applicationDate,
  cashAccountBlock,
  fundingAllows,
  fundingPosition,
  isLegacyAdvance,
  releaseBlockers,
  splitReceiptTotal,
} from './award-payment.policy.js';

const d = (v: string | number) => new Decimal(v);

describe('ADR-045 P2 — award payment policies', () => {
  describe('fundingPosition / fundingAllows', () => {
    const base = { ordered: d('1000.00'), advances: [], purchaseAllocations: [], billAllocations: [] };

    it('equality is allowed; one cent more is refused', () => {
      const p = fundingPosition({ ...base, advances: [{ amount: d('600'), returned: d(0), live: true }] });
      expect(p.funded.toFixed(2)).toBe('600.00');
      expect(p.remaining.toFixed(2)).toBe('400.00');
      expect(fundingAllows(p, d('400.00'))).toBe(true);
      expect(fundingAllows(p, d('400.01'))).toBe(false);
    });

    it('returns lower funded; reversed / cancelled documents are ignored', () => {
      const p = fundingPosition({
        ...base,
        advances: [
          { amount: d('1000'), returned: d('20'), live: true },
          { amount: d('500'), returned: d(0), live: false },
        ],
        purchaseAllocations: [{ amount: d('300'), live: false }],
      });
      expect(p.funded.toFixed(2)).toBe('980.00');
      expect(p.remaining.toFixed(2)).toBe('20.00');
    });

    it('a prepayment later applied to the bill is counted once', () => {
      const p = fundingPosition({
        ...base,
        purchaseAllocations: [{ amount: d('1000'), live: true }],
        billAllocations: [
          // the same payment applied to the PO's bill (EVT-AP-005) — already counted
          { amount: d('1000'), live: true, paymentFundsPoDirectly: true },
        ],
      });
      expect(p.funded.toFixed(2)).toBe('1000.00');
      expect(fundingAllows(p, d('0.01'))).toBe(false);
    });

    it('a bill paid directly counts; a reversed allocation does not', () => {
      const p = fundingPosition({
        ...base,
        billAllocations: [
          { amount: d('400'), live: true, paymentFundsPoDirectly: false },
          { amount: d('100'), live: false, paymentFundsPoDirectly: false },
        ],
      });
      expect(p.funded.toFixed(2)).toBe('400.00');
    });

    it('a posted bill above the order (approved exception) widens the cap to it (Q3)', () => {
      const p = fundingPosition({
        ...base,
        postedBillsTotal: d('1100'),
        advances: [{ amount: d('1000'), returned: d(0), live: true }],
      });
      expect(p.cap.toFixed(2)).toBe('1100.00');
      expect(fundingAllows(p, d('100'))).toBe(true);
      expect(fundingAllows(p, d('100.01'))).toBe(false);
      // Below the order, the order is the cap.
      expect(fundingPosition({ ...base, postedBillsTotal: d('980') }).cap.toFixed(2)).toBe('1000.00');
    });

    it('remaining never goes negative', () => {
      const p = fundingPosition({ ...base, advances: [{ amount: d('1200'), returned: d(0), live: true }] });
      expect(p.remaining.toFixed(2)).toBe('0.00');
    });
  });

  describe('advanceOutstanding', () => {
    it('posted advance: only POSTED applications and the returns count', () => {
      const out = advanceOutstanding(
        { amount: d('1000'), legacy: false },
        [
          { amount: d('980'), postingStatus: 'POSTED' },
          { amount: d('50'), postingStatus: 'REVERSED' },
        ],
        [{ amount: d('5') }],
      );
      expect(out.toFixed(2)).toBe('15.00');
    });

    it('legacy advance keeps the evidence arithmetic (every row counts)', () => {
      const out = advanceOutstanding(
        { amount: d('1000'), legacy: true },
        [{ amount: d('600'), postingStatus: 'NOT_POSTED' }],
        [{ amount: d('100') }],
      );
      expect(out.toFixed(2)).toBe('300.00');
    });

    it('legacy = POSTED without a journal', () => {
      expect(isLegacyAdvance({ postingStatus: 'POSTED', postedJournalEntryId: null })).toBe(true);
      expect(isLegacyAdvance({ postingStatus: 'POSTED', postedJournalEntryId: 'je' })).toBe(false);
      expect(isLegacyAdvance({ postingStatus: 'NOT_POSTED', postedJournalEntryId: null })).toBe(false);
    });
  });

  describe('applicationAmount / applicationDate', () => {
    it.each([
      ['bill smaller', '980', '1000', undefined, '980.00'],
      ['advance smaller', '1030', '1000', undefined, '1000.00'],
      ['requested fits', '980', '1000', '500', '500.00'],
    ])('%s', (_l, bill, adv, req, expected) => {
      const r = applicationAmount(d(bill), d(adv), req === undefined ? undefined : d(req));
      expect('amount' in r && r.amount.toFixed(2)).toBe(expected);
    });

    it('over either outstanding, zero room, or a bad amount is refused', () => {
      expect(applicationAmount(d('980'), d('1000'), d('980.01'))).toEqual({ block: 'APPLICATION_EXCEEDS_OUTSTANDING' });
      expect(applicationAmount(d('980'), d('100'), d('100.01'))).toEqual({ block: 'APPLICATION_EXCEEDS_OUTSTANDING' });
      expect(applicationAmount(d('0'), d('100'))).toEqual({ block: 'APPLICATION_EXCEEDS_OUTSTANDING' });
      expect(applicationAmount(d('10'), d('100'), d('0'))).toEqual({ block: 'APPLICATION_AMOUNT_INVALID' });
      expect(applicationAmount(d('10'), d('100'), d('1.001'))).toEqual({ block: 'APPLICATION_AMOUNT_INVALID' });
    });

    it('the date is the later of the two source documents', () => {
      const bill = new Date('2026-10-09');
      const adv = new Date('2026-10-08');
      expect(applicationDate(bill, adv)).toBe(bill);
      expect(applicationDate(adv, bill)).toBe(bill);
      expect(applicationDate(adv, adv)).toBe(adv);
    });
  });

  describe('splitReceiptTotal', () => {
    const line = (id: string, qty: string, price: string) => ({ id, quantity: d(qty), poUnitPrice: d(price) });
    const cases: Array<[string, string, ReturnType<typeof line>[]]> = [
      ['1 line', '980.00', [line('a', '10', '100')]],
      ['3 lines', '1000.01', [line('a', '3', '33.3333'), line('b', '3', '33.3333'), line('c', '3', '33.3334')]],
      [
        '7 lines',
        '777.77',
        [
          line('a', '1', '1'),
          line('b', '2', '3.33'),
          line('c', '7', '0.07'),
          line('d', '11', '13.13'),
          line('e', '0.5', '99.99'),
          line('f', '3', '7.77'),
          line('g', '13', '0.01'),
        ],
      ],
    ];

    it.each(cases)('%s: sums exactly, never negative, unit price = amount / qty', (_l, total, lines) => {
      const split = splitReceiptTotal(d(total), lines);
      expect(split.reduce((s, l) => s.add(l.amount), d(0)).toFixed(2)).toBe(d(total).toFixed(2));
      for (const l of split) {
        expect(l.amount.isNegative()).toBe(false);
        expect(l.amount.decimalPlaces()).toBeLessThanOrEqual(2);
        expect(l.unitPrice.toFixed(4)).toBe(l.amount.div(l.quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
      }
    });

    it('the remainder lands on the largest line', () => {
      const split = splitReceiptTotal(d('100.00'), [line('a', '1', '1'), line('b', '1', '1'), line('c', '1', '1')]);
      expect(split.map((l) => l.amount.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    });

    it('splits by PO value', () => {
      const split = splitReceiptTotal(d('980.00'), [line('a', '10', '60'), line('b', '10', '40')]);
      expect(split.map((l) => l.amount.toFixed(2))).toEqual(['588.00', '392.00']);
    });
  });

  describe('releaseBlockers / cashAccountBlock', () => {
    it('ready → []; blockers in a stable order', () => {
      const ok = { requestAwarded: true, poOpen: true, pathMatches: true, remainingToFund: d(10), usableAccounts: 1 };
      expect(releaseBlockers(ok)).toEqual([]);
      expect(
        releaseBlockers({
          requestAwarded: true,
          poOpen: false,
          pathMatches: false,
          remainingToFund: d(0),
          staffAdvanceConfigured: false,
          usableAccounts: 0,
          callerIsVendorMaintainer: true,
        }),
      ).toEqual([
        'PAYMENT_PO_NOT_OPEN',
        'PAYMENT_PATH_MISMATCH',
        'NOTHING_TO_FUND',
        'POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE',
        'NO_CASH_ACCOUNT',
        'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT',
      ]);
    });

    it('cash account rules', () => {
      const acct = { status: 'ACTIVE', allowsPayments: true, currencyCode: 'USD' };
      expect(cashAccountBlock(acct, 0, 'USD')).toBeNull();
      expect(cashAccountBlock(acct, 2, 'USD')).toBe('ACCOUNT_REQUIRES_DUAL_CONTROL');
      expect(cashAccountBlock({ ...acct, status: 'CLOSED' }, 0, 'USD')).toBe('ACCOUNT_NOT_USABLE');
      expect(cashAccountBlock({ ...acct, allowsPayments: false }, 0, 'USD')).toBe('ACCOUNT_NOT_USABLE');
      expect(cashAccountBlock(acct, 0, 'SOS')).toBe('CURRENCY_MISMATCH');
    });
  });
});
