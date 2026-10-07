import { Decimal } from '@prisma/client/runtime/library';

import { countBlock, distinctCount, normaliseStoreName, requiredCount, storeKey } from './quote-count.policy.js';
import { awardBlock, lowestQuoteIds, parseQuoteTotal, type QuoteForSelection } from './quote-selection.policy.js';

const d = (v: string | number) => new Decimal(v);

describe('quote count policy (ADR-044 §4.5)', () => {
  it('normalises store names: case, outer and inner spaces', () => {
    expect(normaliseStoreName('  Hodan   Hardware ')).toBe('hodan hardware');
    expect(normaliseStoreName('HODAN\tHARDWARE')).toBe('hodan hardware');
  });

  it('storeKey: supplier id, new-store name, and a new store matching a registered supplier', () => {
    expect(storeKey({ supplierId: 's1' })).toBe('supplier:s1');
    expect(storeKey({ storeName: ' Bakaara  Steel' })).toBe('name:bakaara steel');
    expect(storeKey({ storeName: 'hodan hardware ' }, [{ id: 's9', name: 'Hodan  Hardware' }])).toBe('supplier:s9');
  });

  it('distinctCount counts ACTIVE quotes by store key only', () => {
    expect(
      distinctCount([
        { status: 'ACTIVE', storeKey: 'supplier:a' },
        { status: 'ACTIVE', storeKey: 'supplier:a' },
        { status: 'ACTIVE', storeKey: 'name:b' },
        { status: 'WITHDRAWN', storeKey: 'name:c' },
        { status: 'REJECTED', storeKey: 'name:d' },
      ]),
    ).toBe(2);
  });

  it('requiredCount: 100.00 → 1, 100.01 → 3; unknown estimate asks for 3 at send', () => {
    expect(requiredCount(d('100.00'))).toBe(1);
    expect(requiredCount(d('100.01'))).toBe(3);
    expect(requiredCount(null)).toBe(3);
    // At award: estimate OR award above the threshold.
    expect(requiredCount(d('100.00'), d('100.00'))).toBe(1);
    expect(requiredCount(d('50'), d('100.01'))).toBe(3);
    expect(requiredCount(d('100.01'), d('20'))).toBe(3);
    expect(requiredCount(null, d('80'))).toBe(1);
    expect(requiredCount(null, d('100.01'))).toBe(3);
  });

  it('countBlock: short needs a reason at send, and reason + acceptance at award', () => {
    expect(countBlock({ distinct: 3, required: 3, exceptionReason: null })).toBeNull();
    expect(countBlock({ distinct: 1, required: 3, exceptionReason: null })).toBe('QUOTE_COUNT_EXCEPTION_REQUIRED');
    expect(countBlock({ distinct: 1, required: 3, exceptionReason: 'URGENT' })).toBeNull();
    expect(countBlock({ distinct: 1, required: 3, exceptionReason: 'URGENT', acceptException: false })).toBe(
      'QUOTE_COUNT_EXCEPTION_REQUIRED',
    );
    expect(countBlock({ distinct: 1, required: 3, exceptionReason: 'URGENT', acceptException: true })).toBeNull();
    expect(countBlock({ distinct: 1, required: 3, exceptionReason: null, acceptException: true })).toBe(
      'QUOTE_COUNT_EXCEPTION_REQUIRED',
    );
  });
});

describe('quote selection policy (ADR-044 §4.3–4.4)', () => {
  const q = (id: string, total: string | null, status: QuoteForSelection['status'] = 'ACTIVE'): QuoteForSelection => ({
    id,
    status,
    enteredTotal: total === null ? null : d(total),
  });

  it('parseQuoteTotal: positive, ≤ 2 dp, ≤ 999,999,999.99', () => {
    expect(parseQuoteTotal('1234.50')!.toFixed(2)).toBe('1234.50');
    expect(parseQuoteTotal('999999999.99')!.toFixed(2)).toBe('999999999.99');
    for (const bad of ['0', '0.00', '-5', '1.234', '1000000000.00', 'abc', '', '1e3', null, undefined]) {
      expect(parseQuoteTotal(bad)).toBeNull();
    }
  });

  it('lowest: minimum over ACTIVE quotes with totals; ties are all lowest', () => {
    expect(lowestQuoteIds([q('a', '2350'), q('b', '2410'), q('c', '2295')])).toEqual(['c']);
    expect(lowestQuoteIds([q('a', '100'), q('b', '100'), q('c', '200')])).toEqual(['a', 'b']);
    expect(lowestQuoteIds([q('a', '50', 'REJECTED'), q('b', '60'), q('c', '10', 'WITHDRAWN')])).toEqual(['b']);
    expect(lowestQuoteIds([q('a', null)])).toEqual([]);
  });

  it('awardBlock: active chosen quote, every total present, reason when not lowest, note for OTHER', () => {
    const quotes = [q('a', '2350'), q('b', '2410'), q('c', '2295'), q('x', null, 'REJECTED')];
    expect(awardBlock({ quotes, chosenQuoteId: 'c' })).toBeNull();
    expect(awardBlock({ quotes, chosenQuoteId: 'x' })).toBe('QUOTE_NOT_ACTIVE');
    expect(awardBlock({ quotes, chosenQuoteId: 'missing' })).toBe('QUOTE_NOT_ACTIVE');
    expect(awardBlock({ quotes, chosenQuoteId: 'a' })).toBe('NON_LOWEST_REASON_REQUIRED');
    expect(awardBlock({ quotes, chosenQuoteId: 'a', nonLowestReason: 'HAS_STOCK' })).toBeNull();
    expect(awardBlock({ quotes, chosenQuoteId: 'a', nonLowestReason: 'OTHER' })).toBe('NON_LOWEST_NOTE_REQUIRED');
    expect(awardBlock({ quotes, chosenQuoteId: 'a', nonLowestReason: 'OTHER', nonLowestNote: '  ' })).toBe(
      'NON_LOWEST_NOTE_REQUIRED',
    );
    expect(awardBlock({ quotes, chosenQuoteId: 'a', nonLowestReason: 'OTHER', nonLowestNote: 'Delivers today' })).toBeNull();
    expect(awardBlock({ quotes: [...quotes, q('d', null)], chosenQuoteId: 'c' })).toBe('QUOTE_TOTALS_MISSING');
  });

  it('a rejected quote drops out of lowest, so the next cheapest becomes lowest', () => {
    const quotes = [q('a', '2350'), q('c', '2295', 'REJECTED')];
    expect(lowestQuoteIds(quotes)).toEqual(['a']);
    expect(awardBlock({ quotes, chosenQuoteId: 'a' })).toBeNull();
  });
});
