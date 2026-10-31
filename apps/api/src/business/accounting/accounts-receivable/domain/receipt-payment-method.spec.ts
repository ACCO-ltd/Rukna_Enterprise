import { normaliseDetails, paymentDetailLines, paymentDetailProblems } from './receipt-payment-method';

describe('receipt payment method proof (PM-1)', () => {
  it('a complete bank transfer has no problems; a missing one lists every field', () => {
    expect(
      paymentDetailProblems('BANK_TRANSFER', { issuer: 'Premier Bank', payerName: 'Water Agency', instrumentNumber: 'TT-1', instrumentDate: '2026-10-30' }),
    ).toEqual([]);
    expect(paymentDetailProblems('CASH', {})).toEqual(['Enter the cash receipt-book number, who counted the cash.']);
  });

  it('stores numbers upper-cased and keeps only the method’s fields', () => {
    expect(normaliseDetails('CARD', { issuer: 'VISA', payerAccount: '4242', instrumentNumber: ' ab12 ', receivedBy: 'x' })).toMatchObject({
      instrumentNumber: 'AB12',
      payerAccount: '4242',
      receivedBy: null,
    });
  });

  it('prints each method’s proof as lines for the receipt PDF', () => {
    const none = { instrumentNumber: null, issuer: null, instrumentDate: null, payerName: null, payerAccount: null, receivedBy: null };
    expect(
      paymentDetailLines('CHEQUE', { ...none, instrumentNumber: '118204', issuer: 'Premier Bank', instrumentDate: new Date('2026-11-15'), payerName: 'Water Agency' }),
    ).toEqual(['Cheque no. 118204 · Premier Bank', 'Cheque date 2026-11-15', 'Drawn by Water Agency']);
    expect(paymentDetailLines('MOBILE_MONEY', { ...none, issuer: 'EVC_PLUS', instrumentNumber: '8842213', payerAccount: '+252615555555' })).toEqual([
      'EVC Plus transaction 8842213',
      'From +252615555555',
    ]);
    expect(paymentDetailLines(null, none)).toEqual([]);
  });
});
