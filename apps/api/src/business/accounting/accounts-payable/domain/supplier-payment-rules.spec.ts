import { normaliseProof, paymentProblem, paymentProofProblems, paymentReversalProblem } from './supplier-payment-rules';

describe('supplier payment rules (SP-1, SP-3)', () => {
  it('USD only', () => {
    expect(paymentProblem({ currencyCode: 'USD' })).toBeNull();
    expect(paymentProblem({ currencyCode: 'EUR' })?.errorCode).toBe('CURRENCY_NOT_SUPPORTED');
  });

  it('keeps only the proof a method has, trimmed and upper-cased', () => {
    expect(normaliseProof('CHEQUE', { bankReference: ' chq-9 ', instrumentDate: '2026-10-30', payeeAccount: '123', provider: 'ZAAD' })).toEqual({
      bankReference: 'CHQ-9',
      instrumentDate: new Date('2026-10-30'),
      provider: null,
      payeeAccount: null,
      payeeName: null,
    });
    expect(normaliseProof('MOBILE_MONEY', { provider: 'ZAAD', payeeAccount: '063 4123456' }).payeeAccount).toBe('+252634123456');
    expect(normaliseProof('CASH', {})).toEqual({ bankReference: null, instrumentDate: null, provider: null, payeeAccount: null, payeeName: null });
  });

  it('names bad proof; nothing is required', () => {
    expect(paymentProofProblems('BANK_TRANSFER', {})).toEqual([]);
    expect(paymentProofProblems('MOBILE_MONEY', { provider: 'MPESA', payeeAccount: '12' })).toHaveLength(2);
    expect(paymentProofProblems('CHEQUE', { instrumentDate: 'not a date' })).toHaveLength(1);
  });

  it('a reversal cannot predate the payment', () => {
    const posted = new Date('2026-10-10T00:00:00.000Z');
    expect(paymentReversalProblem(posted, '2026-10-09')?.errorCode).toBe('REVERSAL_BEFORE_PAYMENT');
    expect(paymentReversalProblem(posted, '2026-10-10')).toBeNull();
  });
});
