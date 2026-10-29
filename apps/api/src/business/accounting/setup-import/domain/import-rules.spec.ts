import { findLikelyDuplicate, nameKey, parseAmount, parsePaymentTerms, readRow } from './import-rules';

describe('import rules (Step 5)', () => {
  it('reads payment terms as people write them, and refuses to guess the rest', () => {
    expect(parsePaymentTerms('30')).toBe(30);
    expect(parsePaymentTerms('Net 45')).toBe(45);
    expect(parsePaymentTerms('N30')).toBe(30);
    expect(parsePaymentTerms('60 days')).toBe(60);
    expect(parsePaymentTerms('Due on receipt')).toBe(0);
    expect(parsePaymentTerms('COD')).toBe(0);
    expect(parsePaymentTerms('')).toBeNull();
    expect(parsePaymentTerms('end of month')).toBeUndefined();
    expect(parsePaymentTerms('400')).toBeUndefined();
  });

  it('reads money with separators, symbols and accounting negatives', () => {
    expect(parseAmount('1,234.50')!.toFixed(2)).toBe('1234.50');
    expect(parseAmount('$ 1,000')!.toFixed(2)).toBe('1000.00');
    expect(parseAmount('USD 12.5')!.toFixed(2)).toBe('12.50');
    expect(parseAmount('(250.00)')!.toFixed(2)).toBe('-250.00');
    expect(parseAmount('-75')!.toFixed(2)).toBe('-75.00');
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('12.345')).toBeUndefined();
    expect(parseAmount('ten')).toBeUndefined();
  });

  it('calls two names the same regardless of case, punctuation and company suffix', () => {
    expect(nameKey('Horn Steel Co. Ltd')).toBe(nameKey('HORN STEEL'));
    expect(findLikelyDuplicate({ name: 'Other name', taxNumber: 'tin-001 22' }, [
      { id: 'a', code: 'S1', name: 'Horn Steel', taxNumber: 'TIN00122' },
    ])?.id).toBe('a');
  });

  it('turns every bad cell into a problem on its field, never an exception', () => {
    const read = readRow('suppliers', {
      name: 'Horn Steel', phone: '12', email: 'not-an-email', paymentTerms: 'whenever', openingBalance: '-10', code: 'bad code!',
    }, 'KE');
    expect(read.problems.map((p) => [p.field, p.code])).toEqual([
      ['code', 'CODE_INVALID'],
      ['phone', 'PHONE_INVALID'],
      ['email', 'EMAIL_INVALID'],
      ['paymentTerms', 'PAYMENT_TERMS_UNKNOWN'],
      ['openingBalance', 'BALANCE_NEGATIVE'],
    ]);
    expect(read.openingBalance).toBeNull();
  });

  it('reads a local phone number in the default country, and requires a client contact', () => {
    const read = readRow('clients', { name: 'Water Agency', phone: '0712 345 678', clientType: 'government' }, 'KE');
    expect(read.phone).toBe('+254712345678');
    expect(read.clientType).toBe('GOVERNMENT');
    expect(read.problems.map((p) => p.code)).toEqual(['CONTACT_REQUIRED']);
  });

  it('refuses an opening balance in a currency other than the ledger’s', () => {
    const read = readRow('suppliers', { name: 'A', currency: 'eur', openingBalance: '100' }, 'KE');
    expect(read.problems.map((p) => p.code)).toEqual(['BALANCE_CURRENCY']);
  });
});
