import { describe, expect, it } from 'vitest';

import { MONEY_SCALE, QUANTITY_SCALE, parseMinorUnits } from '@/lib/money';

import {
  ASSUMED_OVER_RECEIPT_PERCENT,
  activeRevision,
  canPostBill,
  exceedsOverReceiptTolerance,
  extendedAmountMinor,
  isEmptyGrnLine,
  latestRevision,
  moneyToApi,
  overReceiptPercent,
  quantityToApi,
  revisionTotalMinor,
  sumExtendedAmountMinor,
  toApiNumber,
  validateGrnLine,
  validateMrLine,
  validateMrScope,
} from './quantities';

/** Reads a decimal string the way a form field would, so tests state real user input. */
const qty = (s: string) => parseMinorUnits(s, QUANTITY_SCALE)!;
const money = (s: string) => parseMinorUnits(s, MONEY_SCALE)!;

// ─── toApiNumber ─────────────────────────────────────────────────────────────────

describe('toApiNumber', () => {
  it('converts money minor units to the number the API expects', () => {
    expect(toApiNumber(money('850.00'), MONEY_SCALE)).toBe(850);
    expect(toApiNumber(money('855.50'), MONEY_SCALE)).toBe(855.5);
  });

  it('converts quantity minor units at three decimal places', () => {
    expect(toApiNumber(qty('25'), QUANTITY_SCALE)).toBe(25);
    expect(toApiNumber(qty('0.500'), QUANTITY_SCALE)).toBe(0.5);
  });

  it('does not reintroduce float error that direct division would', () => {
    // 2999 / 100 is 29.990000000000002 in binary floating point.
    expect(moneyToApi(2999)).toBe(29.99);
    expect(String(moneyToApi(2999))).toBe('29.99');
  });

  it('round-trips every two-decimal value in a representative range', () => {
    for (let minor = 0; minor <= 2000; minor += 1) {
      expect(money(String(moneyToApi(minor).toFixed(2)))).toBe(minor);
    }
  });

  it('handles negative amounts, which reversals produce', () => {
    expect(moneyToApi(-2125000)).toBe(-21250);
  });

  it('converts quantities without dropping the third decimal', () => {
    expect(quantityToApi(qty('1.005'))).toBe(1.005);
  });
});

// ─── extendedAmountMinor ─────────────────────────────────────────────────────────

describe('extendedAmountMinor', () => {
  it('computes the §12.9 worked example: 25 t at 850 = 21,250', () => {
    const extended = extendedAmountMinor(qty('25'), money('850.00'));
    expect(extended).toBe(money('21250.00'));
  });

  it('changes scale correctly — quantity is 3dp and money is 2dp', () => {
    // 2.5 × 10.00 = 25.00, not 2500.00 or 0.25
    expect(extendedAmountMinor(qty('2.5'), money('10.00'))).toBe(money('25.00'));
  });

  it('carries three-decimal quantities into a two-decimal amount', () => {
    // 0.333 × 3.00 = 0.999, which a Decimal(18,2) column rounds to 1.00 — not 0.99.
    expect(extendedAmountMinor(qty('0.333'), money('3.00'))).toBe(money('1.00'));
    // 0.331 × 3.00 = 0.993 rounds the other way
    expect(extendedAmountMinor(qty('0.331'), money('3.00'))).toBe(money('0.99'));
  });

  it('rounds half away from zero, as the decimal column does', () => {
    // 0.005 × 1.00 = 0.005 → 0.01
    expect(extendedAmountMinor(qty('0.005'), money('1.00'))).toBe(money('0.01'));
    // and the negative mirror
    expect(extendedAmountMinor(-qty('0.005'), money('1.00'))).toBe(-money('0.01'));
  });

  it('is exact where repeated float multiplication would drift', () => {
    // 0.1 × 0.3 is 0.030000000000000002 as floats; at 2dp the answer is 0.03
    expect(extendedAmountMinor(qty('0.1'), money('0.30'))).toBe(money('0.03'));
  });

  it('returns null rather than a wrong number when the product overflows', () => {
    expect(extendedAmountMinor(Number.MAX_SAFE_INTEGER, 1000)).toBeNull();
  });

  it('handles a zero quantity', () => {
    expect(extendedAmountMinor(0, money('850.00'))).toBe(0);
  });
});

describe('sumExtendedAmountMinor', () => {
  it('totals a multi-line order', () => {
    const total = sumExtendedAmountMinor([
      { quantityMinor: qty('25'), unitPriceMinor: money('850.00') },
      { quantityMinor: qty('10'), unitPriceMinor: money('120.50') },
    ]);
    expect(total).toBe(money('22455.00'));
  });

  it('is null when any line overflows, rather than skipping it', () => {
    const total = sumExtendedAmountMinor([
      { quantityMinor: qty('25'), unitPriceMinor: money('850.00') },
      { quantityMinor: Number.MAX_SAFE_INTEGER, unitPriceMinor: 1000 },
    ]);
    expect(total).toBeNull();
  });

  it('is zero for no lines', () => {
    expect(sumExtendedAmountMinor([])).toBe(0);
  });
});

describe('revisionTotalMinor', () => {
  it("sums the API's own extendedAmount strings without parsing them as floats", () => {
    const total = revisionTotalMinor([
      { extendedAmount: '21250.00' },
      { extendedAmount: '0.10' },
      { extendedAmount: '0.20' },
    ]);
    // 0.1 + 0.2 is 0.30000000000000004 as floats
    expect(total).toBe(money('21250.30'));
  });
});

// ─── GRN line rules ──────────────────────────────────────────────────────────────

describe('validateGrnLine', () => {
  it('accepts a clean partial-rejection line', () => {
    expect(
      validateGrnLine({
        receivedMinor: qty('24'),
        acceptedMinor: qty('23'),
        rejectedMinor: qty('1'),
      }),
    ).toBeNull();
  });

  it('rejects a split that does not equal received', () => {
    expect(
      validateGrnLine({
        receivedMinor: qty('24'),
        acceptedMinor: qty('23'),
        rejectedMinor: qty('2'),
      }),
    ).toBe('splitMustEqualReceived');
  });

  it('catches a split that is off by a thousandth', () => {
    expect(
      validateGrnLine({
        receivedMinor: qty('1'),
        acceptedMinor: qty('0.999'),
        rejectedMinor: qty('0.001'),
      }),
    ).toBeNull();
    expect(
      validateGrnLine({
        receivedMinor: qty('1'),
        acceptedMinor: qty('0.998'),
        rejectedMinor: qty('0.001'),
      }),
    ).toBe('splitMustEqualReceived');
  });

  it('reports the accepted-is-zero rule on a fully rejected line, not the split rule (P6)', () => {
    // The split is satisfied — 0 + 5 = 5 — so the useful message is the one about
    // acceptedQuantity, which is what the server's @IsPositive() will refuse.
    expect(
      validateGrnLine({
        receivedMinor: qty('5'),
        acceptedMinor: 0,
        rejectedMinor: qty('5'),
      }),
    ).toBe('acceptedMustBePositive');
  });

  it('rejects a zero receipt', () => {
    expect(
      validateGrnLine({ receivedMinor: 0, acceptedMinor: 0, rejectedMinor: 0 }),
    ).toBe('receivedMustBePositive');
  });

  it('rejects negative quantities before anything else', () => {
    expect(
      validateGrnLine({
        receivedMinor: qty('5'),
        acceptedMinor: -qty('1'),
        rejectedMinor: qty('6'),
      }),
    ).toBe('negativeQuantity');
  });
});

describe('isEmptyGrnLine', () => {
  it('identifies an untouched pre-populated row', () => {
    expect(isEmptyGrnLine({ receivedMinor: 0, acceptedMinor: 0, rejectedMinor: 0 })).toBe(true);
  });

  it('does not treat a filled row as empty', () => {
    expect(
      isEmptyGrnLine({ receivedMinor: qty('1'), acceptedMinor: qty('1'), rejectedMinor: 0 }),
    ).toBe(false);
  });
});

// ─── Over-receipt ────────────────────────────────────────────────────────────────

describe('overReceiptPercent', () => {
  it('is zero when the delivery is within the ordered quantity', () => {
    expect(overReceiptPercent(qty('25'), 0, qty('23'))).toBe(0);
    expect(overReceiptPercent(qty('25'), 0, qty('25'))).toBe(0);
  });

  it('accumulates against previous receipts, not just this one', () => {
    // 20 already received, 6 more against an order of 25 → 26 total, 4% over
    expect(overReceiptPercent(qty('25'), qty('20'), qty('6'))).toBeCloseTo(4, 10);
  });

  it('is null when nothing was ordered', () => {
    expect(overReceiptPercent(0, 0, qty('5'))).toBeNull();
  });
});

describe('exceedsOverReceiptTolerance', () => {
  it('does not fire exactly at the assumed threshold', () => {
    // 25 ordered, 26.25 received = exactly 5%; the server uses `>` not `>=`
    expect(exceedsOverReceiptTolerance(qty('25'), 0, qty('26.25'))).toBe(false);
  });

  it('fires just above it', () => {
    expect(exceedsOverReceiptTolerance(qty('25'), 0, qty('26.251'))).toBe(true);
  });

  it('uses the documented fallback, which is only an assumption (P9)', () => {
    expect(ASSUMED_OVER_RECEIPT_PERCENT).toBe(5);
  });
});

// ─── Revision selection ──────────────────────────────────────────────────────────

describe('activeRevision', () => {
  it('finds the ACTIVE revision on a detail response', () => {
    const revs = [
      { revisionNumber: 1, status: 'SUPERSEDED' },
      { revisionNumber: 2, status: 'ACTIVE' },
      { revisionNumber: 3, status: 'DRAFT' },
    ];
    expect(activeRevision(revs)?.revisionNumber).toBe(2);
  });

  it('is null on a list response, where only the newest revision is embedded (P14)', () => {
    expect(activeRevision([{ revisionNumber: 3, status: 'DRAFT' }])).toBeNull();
  });
});

describe('latestRevision', () => {
  it('returns the highest-numbered revision regardless of order', () => {
    const revs = [{ revisionNumber: 3 }, { revisionNumber: 1 }, { revisionNumber: 2 }];
    expect(latestRevision(revs)?.revisionNumber).toBe(3);
  });

  it('is null when there are none', () => {
    expect(latestRevision([])).toBeNull();
  });
});

// ─── Material request rules ──────────────────────────────────────────────────────

describe('validateMrLine', () => {
  it('accepts a complete material line', () => {
    expect(
      validateMrLine({
        lineType: 'MATERIAL',
        materialCode: 'REBAR-12MM',
        description: '12mm rebar',
        quantityMinor: qty('25'),
      }),
    ).toBeNull();
  });

  it('requires a material on a MATERIAL line (rule CAT-001)', () => {
    expect(
      validateMrLine({
        lineType: 'MATERIAL',
        materialCode: null,
        description: '12mm rebar',
        quantityMinor: qty('25'),
      }),
    ).toBe('materialRequired');
  });

  it('does not require a material on a SERVICE line', () => {
    expect(
      validateMrLine({
        lineType: 'SERVICE',
        materialCode: null,
        description: 'Cutting and bending',
        quantityMinor: qty('1'),
      }),
    ).toBeNull();
  });

  it('rejects a whitespace-only description', () => {
    expect(
      validateMrLine({
        lineType: 'SERVICE',
        materialCode: null,
        description: '   ',
        quantityMinor: qty('1'),
      }),
    ).toBe('descriptionRequired');
  });

  it('rejects a zero or unparseable quantity', () => {
    expect(
      validateMrLine({
        lineType: 'SERVICE',
        materialCode: null,
        description: 'x',
        quantityMinor: 0,
      }),
    ).toBe('quantityMustBePositive');

    // parseMinorUnits returns null for a typo, and null must not read as zero
    expect(
      validateMrLine({
        lineType: 'SERVICE',
        materialCode: null,
        description: 'x',
        quantityMinor: null,
      }),
    ).toBe('quantityMustBePositive');
  });
});

describe('validateMrScope', () => {
  it('requires a project on PROJECT scope (rule MR-001)', () => {
    expect(validateMrScope('PROJECT', null)).toBe('projectRequired');
    expect(validateMrScope('PROJECT', 'proj-1')).toBeNull();
  });

  it('allows ORGANIZATION scope with no project', () => {
    expect(validateMrScope('ORGANIZATION', null)).toBeNull();
  });
});

// ─── Bill matching gate ──────────────────────────────────────────────────────────

describe('canPostBill', () => {
  it.each([
    ['MATCHED', true],
    ['MATCHED_WITH_TOLERANCE', true],
    ['APPROVED_EXCEPTION', true],
    ['EXCEPTION', false],
    ['NOT_RUN', false],
  ])('%s → %s for a PO-linked bill', (status, expected) => {
    expect(canPostBill(status, true)).toBe(expected);
  });

  it('blocks NOT_RUN even though the server permits it (P15)', () => {
    // POSTABLE_MATCH_STATUSES on the server includes NOT_RUN. This is deliberately
    // stricter, per §6.31's explicit UI rule.
    expect(canPostBill('NOT_RUN', true)).toBe(false);
  });

  it('does not gate a bill with no purchase order link', () => {
    expect(canPostBill('NOT_RUN', false)).toBe(true);
  });
});
