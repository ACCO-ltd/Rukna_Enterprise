import { Decimal } from '@prisma/client/runtime/library';

import {
  findOverQuantityLines,
  overQuantityMessage,
  type OverQuantityInput,
} from './over-quantity.js';

const line = (over: Partial<OverQuantityInput> = {}): OverQuantityInput => ({
  boqNodeId: 'n-1',
  boqCode: '2.2',
  description: 'RC C30 slab',
  unit: 'm³',
  boqQuantity: new Decimal(60),
  verifiedToDate: new Decimal(58),
  thisReport: new Decimal(12),
  ...over,
});

describe('findOverQuantityLines (CONST-PROG-002/009)', () => {
  it('returns nothing when the report keeps every line within its BOQ quantity', () => {
    expect(findOverQuantityLines([line({ thisReport: new Decimal(2) })])).toEqual([]);
  });

  it('allows a report that lands exactly on the BOQ quantity', () => {
    expect(
      findOverQuantityLines([
        line({ verifiedToDate: new Decimal('59.5'), thisReport: new Decimal('0.5') }),
      ]),
    ).toEqual([]);
  });

  it('names the offending line with decimal strings and the most this report may carry', () => {
    expect(findOverQuantityLines([line()])).toEqual([
      {
        boqNodeId: 'n-1',
        boqCode: '2.2',
        description: 'RC C30 slab',
        unit: 'm³',
        boqQuantity: '60',
        verifiedToDate: '58',
        thisReport: '12',
        maxForThisReport: '2',
      },
    ]);
  });

  it('floors maxForThisReport at 0 when other reports already exceed the quantity', () => {
    const [over] = findOverQuantityLines([
      line({ verifiedToDate: new Decimal(65), thisReport: new Decimal(1) }),
    ]);
    expect(over!.maxForThisReport).toBe('0');
  });

  it('is decimal-exact (no float drift on fractional quantities)', () => {
    // 0.1 + 0.2 must equal 0.3 exactly — a float comparison would call this over.
    expect(
      findOverQuantityLines([
        line({
          boqQuantity: new Decimal('0.3'),
          verifiedToDate: new Decimal('0.1'),
          thisReport: new Decimal('0.2'),
        }),
      ]),
    ).toEqual([]);
  });

  it('returns only the over lines, in input order', () => {
    const result = findOverQuantityLines([
      line({ boqNodeId: 'ok', thisReport: new Decimal(1) }),
      line({ boqNodeId: 'a' }),
      line({
        boqNodeId: 'b',
        boqQuantity: new Decimal(0),
        verifiedToDate: new Decimal(0),
        thisReport: new Decimal(1),
      }),
    ]);
    expect(result.map((l) => l.boqNodeId)).toEqual(['a', 'b']);
  });
});

describe('overQuantityMessage', () => {
  it('names the first line in plain English', () => {
    const lines = findOverQuantityLines([line()]);
    expect(overQuantityMessage(lines)).toBe(
      '2.2 RC C30 slab: this report brings the total to 70 m³ but the BOQ has 60 m³. Enter 2 or less, or raise a variation.',
    );
  });

  it('says nothing more can be recorded when the line is already full', () => {
    const lines = findOverQuantityLines([
      line({ verifiedToDate: new Decimal(60), thisReport: new Decimal(1) }),
    ]);
    expect(overQuantityMessage(lines)).toContain(
      'Nothing more can be recorded on this line; raise a variation.',
    );
  });

  it('counts the other offending lines', () => {
    const lines = findOverQuantityLines([
      line(),
      line({ boqNodeId: 'n-2' }),
      line({ boqNodeId: 'n-3' }),
    ]);
    expect(overQuantityMessage(lines)).toMatch(/2 other lines are also over\.$/);
  });

  it('tolerates a line with no code, description or unit', () => {
    const lines = findOverQuantityLines([line({ boqCode: null, description: null, unit: null })]);
    expect(overQuantityMessage(lines)).toBe(
      'A BOQ line: this report brings the total to 70 but the BOQ has 60. Enter 2 or less, or raise a variation.',
    );
  });
});
