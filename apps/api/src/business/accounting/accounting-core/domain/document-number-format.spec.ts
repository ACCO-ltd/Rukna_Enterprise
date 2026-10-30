import {
  formatDocumentNumber,
  highestCountUsed,
  numberFormatProblems,
  numberStem,
  periodKey,
  type NumberFormat,
} from './document-number-format';

const on = new Date('2026-10-30');
const fmt = (resetPolicy: NumberFormat['resetPolicy'], paddingLength: number): NumberFormat => ({ prefix: 'INV-', resetPolicy, paddingLength });

describe('document number format (CI-8)', () => {
  it('builds each format from the document date', () => {
    expect(formatDocumentNumber(fmt('NEVER', 6), periodKey('NEVER', on), 124)).toBe('INV-000124');
    expect(formatDocumentNumber(fmt('YEARLY', 4), periodKey('YEARLY', on), 1)).toBe('INV-2026-0001');
    expect(formatDocumentNumber(fmt('MONTHLY', 4), periodKey('MONTHLY', on), 12)).toBe('INV-2026-10-0012');
    expect(formatDocumentNumber(fmt('DAILY', 3), periodKey('DAILY', on), 7)).toBe('INV-2026-10-30-007');
  });

  it('lets the count outgrow its digits rather than wrap', () => {
    expect(formatDocumentNumber(fmt('YEARLY', 3), '2026', 1234)).toBe('INV-2026-1234');
  });

  it('reads the highest count used only from numbers in the same format', () => {
    const existing = ['INV-000041', 'INV-000007', 'INV-2026-0099', 'INV-2026-10-0005', 'INV-00004A'];
    expect(highestCountUsed(numberStem(fmt('NEVER', 6), ''), existing)).toBe(41);
    expect(highestCountUsed(numberStem(fmt('YEARLY', 4), '2026'), existing)).toBe(99);
    expect(highestCountUsed(numberStem(fmt('MONTHLY', 4), '2026-10'), existing)).toBe(5);
    expect(highestCountUsed(numberStem(fmt('YEARLY', 4), '2025'), existing)).toBe(0);
  });

  it('lists every problem at once', () => {
    expect(numberFormatProblems({ prefix: 'IN V', resetPolicy: 'YEARLY', paddingLength: 9 }, 0, on)).toEqual([
      'The prefix can hold letters, digits and - / _ . only, with no spaces.',
      'The number can have 3 to 8 digits.',
      'The next number must be a whole number of 1 or more.',
    ]);
    expect(numberFormatProblems(fmt('DAILY', 8), 1, on)).toEqual([]);
    expect(numberFormatProblems({ prefix: 'ACCO-INV-X', resetPolicy: 'DAILY', paddingLength: 3 }, 1234567890, on)).toEqual([
      'An invoice number can be at most 30 characters; ACCO-INV-X2026-10-30-1234567890 is longer.',
    ]);
  });
});
