import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { SupplierBillService } from '../application/supplier-bill.service.js';
import { SupplierPaymentService } from '../application/supplier-payment.service.js';
import {
  billPaymentState,
  billPostingBlock,
  billSettlementBlock,
  isReleaseComplete,
  openingBalanceApTieOutProblem,
  paymentPostingBlock,
  type OpeningBalanceApTieOut,
  summarizeBillPayments,
  supplierBillEligibility,
  type BillEligibilityFacts,
} from './supplier-bill-eligibility.policy.js';

const OPEN = { name: 'Oct 2026', status: 'OPEN' };

/** Opening-balance payables that tie to AP control (journal credits 1,000; bills total 1,000). */
const TIED: OpeningBalanceApTieOut = {
  apAccount: { id: 'ap', code: '2000' },
  journal: { journalNumber: 'JE-000001' },
  journalNetCredit: '1000',
  importedBillsTotal: '1000.00',
};

function facts(over: Partial<BillEligibilityFacts['bill']> = {}, rest: Partial<BillEligibilityFacts> = {}): BillEligibilityFacts {
  return {
    bill: {
      id: 'b1',
      documentStatus: 'APPROVED',
      postingStatus: 'NOT_POSTED',
      matchStatus: 'NOT_RUN',
      purchaseOrderRevisionId: null,
      outstandingAmount: '1000.00',
      ...over,
    },
    postingPeriod: OPEN,
    allocations: [],
    ...rest,
  };
}

const stepOf = (e: ReturnType<typeof supplierBillEligibility>, key: string) => e.steps.find((s) => s.key === key)!;

describe('billPostingBlock — the post command order', () => {
  it.each([
    ['DRAFT', 'BILL_NOT_SUBMITTED'],
    ['SUBMITTED', 'BILL_AWAITING_APPROVAL'],
    ['REJECTED', 'BILL_REJECTED'],
    ['CANCELLED', 'BILL_CANCELLED'],
  ])('%s → %s', (documentStatus, code) => {
    expect(billPostingBlock({ documentStatus, postingStatus: 'NOT_POSTED', matchStatus: 'MATCHED', purchaseOrderRevisionId: null })).toBe(code);
  });
  it('approval is checked before the match (as the command does)', () => {
    expect(billPostingBlock({ documentStatus: 'SUBMITTED', postingStatus: 'NOT_POSTED', matchStatus: 'EXCEPTION', purchaseOrderRevisionId: 'r' })).toBe('BILL_AWAITING_APPROVAL');
  });
  it('posted / reversed', () => {
    expect(billPostingBlock({ documentStatus: 'APPROVED', postingStatus: 'POSTED', matchStatus: 'NOT_RUN', purchaseOrderRevisionId: null })).toBe('BILL_ALREADY_POSTED');
    expect(billPostingBlock({ documentStatus: 'APPROVED', postingStatus: 'REVERSED', matchStatus: 'NOT_RUN', purchaseOrderRevisionId: null })).toBe('BILL_REVERSED');
  });
  it.each([
    ['NOT_RUN', 'MATCH_NOT_RUN'],
    ['EXCEPTION', 'MATCH_EXCEPTION'],
    ['DISPUTED', 'MATCH_DISPUTED'],
    ['MATCHED', null],
    ['MATCHED_WITH_TOLERANCE', null],
    ['APPROVED_EXCEPTION', null],
  ])('PO-backed bill with match %s → %s', (matchStatus, code) => {
    expect(billPostingBlock({ documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED', matchStatus, purchaseOrderRevisionId: 'r' })).toBe(code);
  });
  it('an opening-balance bill is never posted again', () => {
    expect(billPostingBlock({ documentStatus: 'APPROVED', postingStatus: 'OPENING_BALANCE', matchStatus: 'NOT_RUN', purchaseOrderRevisionId: null })).toBe('OPENING_BALANCE_BILL');
  });
  it('a non-PO bill skips the match', () => {
    expect(billPostingBlock({ documentStatus: 'APPROVED', postingStatus: 'FAILED', matchStatus: 'NOT_RUN', purchaseOrderRevisionId: null })).toBeNull();
  });
});

describe('billSettlementBlock / paymentPostingBlock / release', () => {
  it('only bills in the ledger (POSTED / OPENING_BALANCE) are paid; allocation may not exceed the outstanding', () => {
    expect(billSettlementBlock({ postingStatus: 'APPROVED', outstandingAmount: '10' })).toBe('BILL_NOT_POSTED');
    expect(billSettlementBlock({ postingStatus: 'NOT_POSTED', outstandingAmount: '10' })).toBe('BILL_NOT_POSTED');
    expect(billSettlementBlock({ postingStatus: 'REVERSED', outstandingAmount: '10' })).toBe('BILL_NOT_POSTED');
    expect(billSettlementBlock({ postingStatus: 'OPENING_BALANCE', outstandingAmount: '10' }, undefined, TIED)).toBeNull();
    expect(billSettlementBlock({ postingStatus: 'OPENING_BALANCE', outstandingAmount: '0' }, undefined, TIED)).toBe('NOTHING_OUTSTANDING');
    expect(billSettlementBlock({ postingStatus: 'OPENING_BALANCE', outstandingAmount: '10' }, new Decimal(11), TIED)).toBe('EXCEEDS_OUTSTANDING');
    // Without a tie-out (or one that fails) an opening-balance bill is refused.
    expect(billSettlementBlock({ postingStatus: 'OPENING_BALANCE', outstandingAmount: '10' })).toBe('OPENING_BALANCE_AP_NOT_RECONCILED');
    expect(billSettlementBlock({ postingStatus: 'POSTED', outstandingAmount: '0' })).toBe('NOTHING_OUTSTANDING');
    expect(billSettlementBlock({ postingStatus: 'POSTED', outstandingAmount: '10' })).toBeNull();
    expect(billSettlementBlock({ postingStatus: 'POSTED', outstandingAmount: '10' }, new Decimal(11))).toBe('EXCEEDS_OUTSTANDING');
    expect(billSettlementBlock({ postingStatus: 'POSTED', outstandingAmount: '10' }, new Decimal(10))).toBeNull();
  });
  it('opening-balance AP tie-out: equal → none; mismatch / no journal / no account → plain words', () => {
    expect(openingBalanceApTieOutProblem(TIED)).toBeNull();
    expect(openingBalanceApTieOutProblem({ ...TIED, journalNetCredit: '600' })).toBe(
      'Opening-balance payables do not tie to the AP control account (journal JE-000001 credits 2000 600.00, imported bills total 1000.00). Fix the opening balance before paying.',
    );
    expect(openingBalanceApTieOutProblem({ ...TIED, journal: null, journalNetCredit: '0' })).toMatch(/no opening-balance journal is posted/);
    expect(openingBalanceApTieOutProblem({ ...TIED, apAccount: null })).toMatch(/no single AP control account/);
    expect(openingBalanceApTieOutProblem(undefined)).not.toBeNull();
  });
  it('dual control needs RELEASED; otherwise APPROVED', () => {
    expect(paymentPostingBlock({ documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }, true)).toBe('PAYMENT_NOT_RELEASED');
    expect(paymentPostingBlock({ documentStatus: 'RELEASED', postingStatus: 'NOT_POSTED' }, true)).toBeNull();
    expect(paymentPostingBlock({ documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' }, false)).toBe('PAYMENT_NOT_APPROVED');
    expect(paymentPostingBlock({ documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }, false)).toBeNull();
    expect(paymentPostingBlock({ documentStatus: 'APPROVED', postingStatus: 'POSTED' }, false)).toBe('PAYMENT_ALREADY_POSTED');
  });
  it('two signatures release', () => {
    expect(isReleaseComplete(1)).toBe(false);
    expect(isReleaseComplete(2)).toBe(true);
  });
});

describe('summarizeBillPayments / billPaymentState', () => {
  const alloc = (amount: string, postingStatus: string, paymentId: string, date: string) => ({
    allocatedAmount: amount,
    postingStatus,
    paymentId,
    paymentDate: new Date(date),
  });
  it('paid = posted, pending = not yet posted, reversed ignored, last date of a posted payment', () => {
    const s = summarizeBillPayments([
      alloc('100', 'POSTED', 'p1', '2026-09-01'),
      alloc('50', 'POSTED', 'p2', '2026-09-20'),
      alloc('30', 'NOT_POSTED', 'p3', '2026-10-01'),
      alloc('999', 'REVERSED', 'p4', '2026-10-02'),
    ]);
    expect(s.paid.toFixed(2)).toBe('150.00');
    expect(s.pending.toFixed(2)).toBe('30.00');
    expect(s.paidPaymentCount).toBe(2);
    expect(s.lastPaymentDate).toBe('2026-09-20');
  });
  it('states', () => {
    const z = { paid: new Decimal(0), pending: new Decimal(0) };
    expect(billPaymentState({ postingStatus: 'NOT_POSTED', totalAmount: '10' }, z)).toBe('NOT_POSTED');
    expect(billPaymentState({ postingStatus: 'REVERSED', totalAmount: '10' }, z)).toBe('REVERSED');
    expect(billPaymentState({ postingStatus: 'POSTED', totalAmount: '10' }, z)).toBe('UNPAID');
    expect(billPaymentState({ postingStatus: 'POSTED', totalAmount: '10' }, { ...z, pending: new Decimal(10) })).toBe('PAYMENT_IN_PROGRESS');
    expect(billPaymentState({ postingStatus: 'POSTED', totalAmount: '10' }, { ...z, paid: new Decimal(4) })).toBe('PARTIALLY_PAID');
    expect(billPaymentState({ postingStatus: 'POSTED', totalAmount: '10' }, { ...z, paid: new Decimal(10) })).toBe('PAID');
  });
});

describe('supplierBillEligibility — steps', () => {
  it('draft non-PO bill: submit pending (with the return reason), match N/A, approval pending', () => {
    const e = supplierBillEligibility(facts({ documentStatus: 'DRAFT', returnReason: 'Wrong VAT' }));
    expect(stepOf(e, 'SUBMITTED')).toMatchObject({ status: 'PENDING', owner: 'FINANCE', code: 'BILL_NOT_SUBMITTED', detail: 'Returned for correction: Wrong VAT' });
    expect(stepOf(e, 'MATCHED').status).toBe('NOT_APPLICABLE');
    expect(stepOf(e, 'APPROVED')).toMatchObject({ status: 'PENDING', owner: 'APPROVER', code: 'BILL_NOT_SUBMITTED' });
    expect(e.canPost).toBe(false);
    expect(e.canPay).toBe(false);
    expect(e.blockedReason).toBe('BILL_NOT_SUBMITTED');
  });

  it('rejected / cancelled bills are blocked', () => {
    expect(stepOf(supplierBillEligibility(facts({ documentStatus: 'REJECTED' })), 'SUBMITTED')).toMatchObject({ status: 'BLOCKED', code: 'BILL_REJECTED' });
    expect(stepOf(supplierBillEligibility(facts({ documentStatus: 'CANCELLED' })), 'APPROVED')).toMatchObject({ status: 'BLOCKED', code: 'BILL_CANCELLED' });
  });

  it('PO bill: match NOT_RUN pending, EXCEPTION / DISPUTED blocked (owner Procurement), MATCHED done', () => {
    const run = (matchStatus: string) =>
      stepOf(supplierBillEligibility(facts({ purchaseOrderRevisionId: 'r', matchStatus })), 'MATCHED');
    expect(run('NOT_RUN')).toMatchObject({ status: 'PENDING', code: 'MATCH_NOT_RUN', owner: 'PROCUREMENT' });
    expect(run('EXCEPTION')).toMatchObject({ status: 'BLOCKED', code: 'MATCH_EXCEPTION' });
    expect(run('DISPUTED')).toMatchObject({ status: 'BLOCKED', code: 'MATCH_DISPUTED' });
    expect(run('MATCHED')).toMatchObject({ status: 'DONE', code: null });
    expect(supplierBillEligibility(facts({ purchaseOrderRevisionId: 'r', matchStatus: 'EXCEPTION' })).blockedReason).toBe('MATCH_EXCEPTION');
  });

  it.each([
    [null, 'NO_PERIOD'],
    [{ name: 'Sep', status: 'CLOSED' }, 'PERIOD_CLOSED'],
    [{ name: 'Dec', status: 'LOCKED' }, 'PERIOD_LOCKED'],
  ])('approved bill in a blocked period (%o) cannot post: %s', (period, code) => {
    const e = supplierBillEligibility(facts({}, { postingPeriod: period }));
    expect(stepOf(e, 'PERIOD_OPEN')).toMatchObject({ status: 'BLOCKED', code, owner: 'FINANCE' });
    expect(e.canPost).toBe(false);
    expect(e.blockedReason).toBe(code);
  });

  it('approved, matched, period open → canPost; a failed posting attempt is retryable', () => {
    const e = supplierBillEligibility(facts({ postingStatus: 'FAILED', lastPostingErrorCode: 'No effective account' }));
    expect(e.canPost).toBe(true);
    expect(e.blockedReason).toBeNull();
    expect(stepOf(e, 'POSTED')).toMatchObject({ status: 'PENDING', code: 'POSTING_FAILED', detail: 'No effective account' });
    expect(stepOf(e, 'PAID')).toMatchObject({ status: 'PENDING', code: 'BILL_NOT_POSTED' });
  });

  it('reversed bill: posting blocked, payment steps not applicable', () => {
    const e = supplierBillEligibility(facts({ postingStatus: 'REVERSED' }));
    expect(stepOf(e, 'POSTED')).toMatchObject({ status: 'BLOCKED', code: 'BILL_REVERSED' });
    expect(stepOf(e, 'PAID').status).toBe('NOT_APPLICABLE');
    expect(e.blockedReason).toBe('BILL_REVERSED');
    expect(e.canPost || e.canPay).toBe(false);
  });

  it('posted, nothing paid yet → canPay, payment steps say "no payment recorded"', () => {
    const e = supplierBillEligibility(facts({ postingStatus: 'POSTED' }));
    expect(e.canPay).toBe(true);
    expect(e.canPost).toBe(false);
    expect(e.blockedReason).toBeNull();
    expect(stepOf(e, 'PAYMENT_APPROVED')).toMatchObject({ status: 'PENDING', code: 'NO_PAYMENT_RECORDED', owner: 'FINANCE' });
  });

  it('opening-balance bill: in the ledger already, never posted again, but payable like a posted bill', () => {
    const e = supplierBillEligibility(facts({ postingStatus: 'OPENING_BALANCE' }, { postingPeriod: null, openingBalanceTieOut: TIED }));
    expect(e.canPost).toBe(false);
    expect(e.canPay).toBe(true);
    expect(e.blockedReason).toBeNull();
    expect(stepOf(e, 'POSTED')).toMatchObject({
      status: 'DONE',
      detail: 'Opening balance — carried from the previous system, already in the ledger',
    });
    expect(stepOf(e, 'PERIOD_OPEN').status).toBe('NOT_APPLICABLE');
    for (const key of ['PAYMENT_APPROVED', 'PAYMENT_RELEASED', 'PAID']) {
      expect(stepOf(e, key)).toMatchObject({ status: 'PENDING', code: 'NO_PAYMENT_RECORDED' });
    }
  });

  it('opening-balance bill: part paid, in flight and paid in full read exactly as for a posted bill', () => {
    const ob = (outstandingAmount: string, rest: Partial<BillEligibilityFacts> = {}) =>
      supplierBillEligibility(facts({ postingStatus: 'OPENING_BALANCE', outstandingAmount }, { postingPeriod: null, openingBalanceTieOut: TIED, ...rest }));
    const posted = { postingStatus: 'POSTED', payment: { documentStatus: 'APPROVED', postingStatus: 'POSTED', underDualControl: false, signatures: 0 } };
    const part = ob('400', { allocations: [posted] });
    expect(part.canPay).toBe(true);
    expect(stepOf(part, 'PAID')).toMatchObject({ status: 'PENDING', code: 'PARTLY_PAID' });
    const paid = ob('0', { allocations: [posted] });
    expect(paid.canPay).toBe(false);
    expect(paid.blockedReason).toBe('FULLY_PAID');
    expect(stepOf(paid, 'PAID').status).toBe('DONE');
    const drafted = ob('0', {
      allocations: [{ postingStatus: 'NOT_POSTED', payment: { documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', underDualControl: true, signatures: 0 } }],
    });
    expect(drafted.blockedReason).toBe('PAYMENT_AWAITING_APPROVAL');
  });

  it('opening-balance bill whose payables do not tie to AP control: refused, said plainly', () => {
    const e = supplierBillEligibility(
      facts({ postingStatus: 'OPENING_BALANCE' }, { postingPeriod: null, openingBalanceTieOut: { ...TIED, journalNetCredit: '0' } }),
    );
    expect(e.canPay).toBe(false);
    expect(e.blockedReason).toBe('OPENING_BALANCE_AP_NOT_RECONCILED');
    expect(stepOf(e, 'POSTED').status).toBe('DONE');
    for (const key of ['PAYMENT_APPROVED', 'PAYMENT_RELEASED', 'PAID']) {
      expect(stepOf(e, key)).toMatchObject({ status: 'BLOCKED', code: 'OPENING_BALANCE_AP_NOT_RECONCILED' });
      expect(stepOf(e, key).detail).toMatch(/do not tie to the AP control account/);
    }
  });

  it('part paid with nothing in flight reads PARTLY_PAID, not "no payment recorded"', () => {
    const e = supplierBillEligibility(
      facts({ postingStatus: 'POSTED', outstandingAmount: '50' }, {
        allocations: [{ postingStatus: 'POSTED', payment: { documentStatus: 'APPROVED', postingStatus: 'POSTED', underDualControl: false, signatures: 0 } }],
      }),
    );
    expect(e.canPay).toBe(true);
    expect(stepOf(e, 'PAID')).toMatchObject({ status: 'PENDING', code: 'PARTLY_PAID' });
    expect(stepOf(e, 'PAYMENT_APPROVED').code).toBe('PARTLY_PAID');
  });

  const inFlight = (documentStatus: string, underDualControl: boolean, signatures = 0) => ({
    postingStatus: 'NOT_POSTED',
    payment: { documentStatus, postingStatus: 'NOT_POSTED', underDualControl, signatures },
  });

  it('whole balance on a DRAFT payment → awaiting approval', () => {
    const e = supplierBillEligibility(facts({ postingStatus: 'POSTED', outstandingAmount: '0' }, { allocations: [inFlight('DRAFT', true)] }));
    expect(e.canPay).toBe(false);
    expect(e.blockedReason).toBe('PAYMENT_AWAITING_APPROVAL');
    expect(stepOf(e, 'PAYMENT_APPROVED')).toMatchObject({ status: 'PENDING', owner: 'APPROVER' });
    expect(e.paymentsInFlight).toBe(1);
  });

  it('approved payment under dual control → awaiting release with the signature count', () => {
    const e = supplierBillEligibility(facts({ postingStatus: 'POSTED', outstandingAmount: '0' }, { allocations: [inFlight('APPROVED', true, 1)] }));
    expect(e.blockedReason).toBe('PAYMENT_AWAITING_RELEASE');
    expect(stepOf(e, 'PAYMENT_RELEASED')).toMatchObject({ status: 'PENDING', owner: 'SIGNATORIES', detail: '1 of 2 signatures' });
  });

  it('approved payment without dual control → release N/A, waiting to post', () => {
    const e = supplierBillEligibility(facts({ postingStatus: 'POSTED', outstandingAmount: '0' }, { allocations: [inFlight('APPROVED', false)] }));
    expect(stepOf(e, 'PAYMENT_RELEASED').status).toBe('NOT_APPLICABLE');
    expect(e.blockedReason).toBe('PAYMENT_NOT_POSTED');
  });

  it('cancelled payments are not in flight; fully paid reads FULLY_PAID', () => {
    const e = supplierBillEligibility(
      facts({ postingStatus: 'POSTED', outstandingAmount: '0' }, {
        allocations: [
          { postingStatus: 'POSTED', payment: { documentStatus: 'RELEASED', postingStatus: 'POSTED', underDualControl: true, signatures: 2 } },
          inFlight('CANCELLED', false),
        ],
      }),
    );
    expect(e.paymentsInFlight).toBe(0);
    expect(e.blockedReason).toBe('FULLY_PAID');
    expect(stepOf(e, 'PAID').status).toBe('DONE');
  });
});

// ─── The read model agrees with the commands ────────────────────────────────────

const identity = { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions: [] } as never;

function postHarness(bill: Record<string, unknown>) {
  const repo = { findById: jest.fn().mockResolvedValue(bill), markPostingFailed: jest.fn() };
  // The AP account lookup is the first step after the guard: NotFound = the guard let it through.
  const accountRepo = { findByCode: jest.fn().mockResolvedValue(null) };
  const svc = new SupplierBillService(
    { getClient: () => ({}) } as never,
    repo as never,
    accountRepo as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return svc;
}

describe('eligibility.canPost ⇔ SupplierBillService.post passes its guard', () => {
  const cases: Array<[string, string, string, string | null]> = [
    ['DRAFT', 'NOT_POSTED', 'NOT_RUN', null],
    ['SUBMITTED', 'NOT_POSTED', 'MATCHED', 'r'],
    ['REJECTED', 'NOT_POSTED', 'NOT_RUN', null],
    ['APPROVED', 'POSTED', 'MATCHED', 'r'],
    ['APPROVED', 'REVERSED', 'NOT_RUN', null],
    ['APPROVED', 'NOT_POSTED', 'EXCEPTION', 'r'],
    ['APPROVED', 'NOT_POSTED', 'DISPUTED', 'r'],
    ['APPROVED', 'NOT_POSTED', 'NOT_RUN', 'r'],
    ['APPROVED', 'NOT_POSTED', 'APPROVED_EXCEPTION', 'r'],
    ['APPROVED', 'FAILED', 'NOT_RUN', null],
    ['APPROVED', 'OPENING_BALANCE', 'NOT_RUN', null],
  ];
  it.each(cases)('doc %s / posting %s / match %s / po %s', async (documentStatus, postingStatus, matchStatus, rev) => {
    const bill = { id: 'b1', documentStatus, postingStatus, matchStatus, purchaseOrderRevisionId: rev, outstandingAmount: '10', lines: [] };
    const e = supplierBillEligibility(facts(bill as never));
    const run = postHarness(bill).post(identity, { billId: 'b1', apAccountCode: 'AP' });
    if (e.canPost) {
      await expect(run).rejects.toBeInstanceOf(NotFoundException); // passed the guard
    } else {
      const expected = ['POSTED', 'REVERSED', 'OPENING_BALANCE'].includes(postingStatus) ? ConflictException : BadRequestException;
      await expect(run).rejects.toBeInstanceOf(expected);
    }
  });
});

describe('eligibility.canPay ⇔ SupplierPaymentService.create accepts an allocation', () => {
  /** A tenant whose opening-balance payables tie (journal credit = bills total = `obCredit`). */
  function payHarness(bill: Record<string, unknown>, obCredit = '100') {
    const tx = {
      account: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ap', code: '2000', status: 'ACTIVE', versions: [{ accountSubtype: 'ACCOUNTS_PAYABLE' }] },
        ]),
      },
      journalEntry: { findMany: jest.fn().mockResolvedValue([{ id: 'j1', journalNumber: 'JE-000001' }]) },
      supplierBill: { aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: '100' } }) },
      journalLine: { aggregate: jest.fn().mockResolvedValue({ _sum: { creditAmount: obCredit, debitAmount: '0' } }) },
    };
    const prisma = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ createdBy: 'someone' }) },
      $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    };
    const billRepo = { findById: jest.fn().mockResolvedValue(bill), updateOutstandingAmount: jest.fn() };
    const paymentRepo = { create: jest.fn().mockResolvedValue({ id: 'p1' }), createAllocation: jest.fn() };
    const svc = new SupplierPaymentService(
      { getClient: () => prisma } as never,
      paymentRepo as never,
      billRepo as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
      { assertAllowed: jest.fn() } as never,
      {} as never, {} as never,
    );
    return { svc, paymentRepo };
  }
  const base = { id: 'b1', supplierId: 's1', currencyCode: 'USD', documentStatus: 'APPROVED', matchStatus: 'MATCHED', purchaseOrderRevisionId: null };
  it.each([
    ['NOT_POSTED', '100', '100'],
    ['POSTED', '100', '100'],
    ['POSTED', '0', '100'],
    ['REVERSED', '100', '100'],
    ['OPENING_BALANCE', '100', '100'],
    ['OPENING_BALANCE', '0', '100'],
    ['OPENING_BALANCE', '100', '40'], // payables not on AP control
  ])('posting %s, outstanding %s, opening journal credits %s', async (postingStatus, outstandingAmount, obCredit) => {
    const bill = { ...base, postingStatus, outstandingAmount };
    const tieOut: OpeningBalanceApTieOut = {
      apAccount: { id: 'ap', code: '2000' },
      journal: { journalNumber: 'JE-000001' },
      journalNetCredit: obCredit,
      importedBillsTotal: '100',
    };
    const e = supplierBillEligibility(facts(bill as never, { openingBalanceTieOut: tieOut }));
    const { svc, paymentRepo } = payHarness(bill, obCredit);
    const run = svc.create(identity, {
      supplierId: 's1', bankAccountId: 'ba', paymentDate: '2026-10-01', currencyCode: 'USD', totalAmount: 1,
      paymentMethod: 'BANK', allocations: [{ supplierBillId: 'b1', amount: 1 }],
    });
    if (e.canPay) {
      await expect(run).resolves.toMatchObject({ id: 'p1' });
      expect(paymentRepo.createAllocation).toHaveBeenCalled();
    } else {
      await expect(run).rejects.toBeInstanceOf(
        e.blockedReason === 'OPENING_BALANCE_AP_NOT_RECONCILED' ? ConflictException : BadRequestException,
      );
      expect(paymentRepo.createAllocation).not.toHaveBeenCalled();
    }
  });
});
