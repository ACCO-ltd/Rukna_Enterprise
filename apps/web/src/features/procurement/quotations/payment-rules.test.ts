import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import {
  amountProblem,
  bandSteps,
  blockerCodes,
  buyerStage,
  gatedInstanceOf,
  isPaymentReadModel,
  outstandingAdvances,
  primaryFinanceAction,
  storeDocumentIdOf,
  toMoneyString,
  todayInMogadishu,
  topUpBillId,
} from './payment-rules';
import { paymentFixture } from './payment-fixtures';

describe('payment rules', () => {
  it('picks the one primary action in work order, preferring an enabled one', () => {
    const payment = paymentFixture({
      allowedActions: [
        { action: 'RELEASE_CASH', enabled: false, reason: 'FUNDING_EXCEEDS_ORDER' },
        { action: 'RECORD_RECEIPT', enabled: true },
        { action: 'TOP_UP', enabled: true },
      ],
    });
    expect(primaryFinanceAction(payment)?.action).toBe('RECORD_RECEIPT');

    const blocked = paymentFixture({
      allowedActions: [{ action: 'RELEASE_CASH', enabled: false, reason: 'ACCOUNT_REQUIRES_DUAL_CONTROL' }],
    });
    // Disabled still shows — with the server's reason — rather than an empty section.
    expect(primaryFinanceAction(blocked)).toEqual({
      action: 'RELEASE_CASH',
      enabled: false,
      reason: 'ACCOUNT_REQUIRES_DUAL_CONTROL',
    });
    expect(primaryFinanceAction(paymentFixture({ allowedActions: [] }))).toBeNull();
  });

  it('reads the DoA gate only from a 409 carrying approvalInstanceId', () => {
    expect(gatedInstanceOf(new ApiError(409, 'gated', 'CONFLICT', [], { approvalInstanceId: 'wf1' }))).toBe('wf1');
    expect(gatedInstanceOf(new ApiError(409, 'no', 'CONFLICT', [], { code: 'FUNDING_EXCEEDS_ORDER' }))).toBeNull();
    expect(gatedInstanceOf(new ApiError(403, 'no', 'FORBIDDEN', [], { approvalInstanceId: 'wf1' }))).toBeNull();
    expect(gatedInstanceOf(new Error('x'))).toBeNull();
  });

  it('normalises blockers and band steps whatever their shape', () => {
    expect(blockerCodes(['NO_ELIGIBLE_CASH_ACCOUNT', { code: 'PERIOD_CLOSED', period: '2026-10' }])).toEqual([
      'NO_ELIGIBLE_CASH_ACCOUNT',
      'PERIOD_CLOSED',
    ]);
    expect(bandSteps({ name: '$1k–$10k', steps: ['Finance Officer', { roleRequired: 'CFO' }] })).toEqual([
      'Finance Officer',
      'CFO',
    ]);
    expect(bandSteps(null)).toEqual([]);
  });

  it('checks an amount against the stated cap in minor units', () => {
    expect(amountProblem('', '1000.00')).toBe('empty');
    expect(amountProblem('0', '1000.00')).toBe('zero');
    expect(amountProblem('1000.00', '1000.00')).toBeNull();
    expect(amountProblem('1000.01', '1000.00')).toBe('over');
    expect(amountProblem('5', null)).toBeNull();
    expect(toMoneyString('980')).toBe('980.00');
    expect(toMoneyString('abc')).toBeNull();
  });

  it('dates in Mogadishu (UTC+3): 22:30 UTC is already the next day there', () => {
    expect(todayInMogadishu(new Date('2026-10-08T22:30:00Z'))).toBe('2026-10-09');
    expect(todayInMogadishu(new Date('2026-10-08T20:59:00Z'))).toBe('2026-10-08');
  });

  it('lists advances with money still out, largest first', () => {
    const payment = paymentFixture({
      advances: [
        { id: 'a1', recipientName: 'Ahmed', amount: '1000.00', advancedAt: '2026-10-08', applied: '980.00', returned: '0.00', outstanding: '20.00', legacy: false },
        { id: 'a2', recipientName: 'Ahmed', amount: '30.00', advancedAt: '2026-10-08', applied: '30.00', returned: '0.00', outstanding: '0.00', legacy: false },
        { id: 'a3', recipientName: 'Ahmed', amount: '50.00', advancedAt: '2026-10-08', applied: '0.00', returned: '0.00', outstanding: '50.00', legacy: false },
      ],
    });
    expect(outstandingAdvances(payment).map((a) => a.id)).toEqual(['a3', 'a1']);
  });

  it('finds the store document id and the top-up bill from loosely shaped responses', () => {
    expect(storeDocumentIdOf({ storeDocument: { id: 'sd1' } } as never)).toBe('sd1');
    expect(storeDocumentIdOf({ id: 'sd2' } as never)).toBe('sd2');
    expect(storeDocumentIdOf(null)).toBeNull();
    const payment = paymentFixture({
      storeDocuments: [
        { id: 'd1', number: 'SD-1', kind: 'RECEIPT', status: 'RECORDED', uploadedByName: 'Ahmed', createdAt: '2026-10-08T07:00:00Z', supplierBillId: 'b1' },
      ],
    });
    expect(topUpBillId(payment)).toBe('b1');
    expect(isPaymentReadModel(payment)).toBe(true);
    expect(isPaymentReadModel({ id: 'sp1', documentStatus: 'APPROVED' })).toBe(false);
  });

  it("maps the payment state to the buyer's four steps", () => {
    expect(buyerStage(paymentFixture({ state: 'READY_TO_PAY' }))).toBe('waiting');
    expect(buyerStage(paymentFixture({ state: 'AWAITING_APPROVAL' }))).toBe('waiting');
    expect(buyerStage(paymentFixture({ state: 'CASH_WITH_BUYER' }))).toBe('released');
    expect(
      buyerStage(
        paymentFixture({
          state: 'RECEIPT_TO_RECORD',
          storeDocuments: [
            { id: 'd1', number: 'SD-1', kind: 'RECEIPT', status: 'SUBMITTED', uploadedByName: 'Ahmed', createdAt: '2026-10-08T07:00:00Z' },
          ],
        }),
      ),
    ).toBe('sent');
    expect(buyerStage(paymentFixture({ state: 'SETTLED' }))).toBe('settled');
  });
});
