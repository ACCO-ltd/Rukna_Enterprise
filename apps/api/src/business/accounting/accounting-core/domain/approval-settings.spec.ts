import { Decimal } from '@prisma/client/runtime/library';

import {
  approvalSettingsProblems,
  billPostsOnSave,
  DEFAULT_APPROVAL_SETTINGS,
  invoiceNeedsApproval,
  paymentApprovedOnSave,
  toApprovalSettings,
} from './approval-settings.js';

const d = (v: string) => new Decimal(v);

describe('ADR-046 §8 approval settings', () => {
  it('defaults to no extra approvals, and payments approved on Save up to the $1,000 band', () => {
    expect(invoiceNeedsApproval(DEFAULT_APPROVAL_SETTINGS, d('1000000'))).toBe(false);
    expect(billPostsOnSave(DEFAULT_APPROVAL_SETTINGS, { hasPurchaseOrder: false, matchStatus: 'NOT_RUN', total: d('50000') })).toBe(true);
    expect(paymentApprovedOnSave(DEFAULT_APPROVAL_SETTINGS, d('1000.00'))).toBe(true);
    expect(paymentApprovedOnSave(DEFAULT_APPROVAL_SETTINGS, d('1000.01'))).toBe(false);
  });

  it('asks for approval at or above the amount set', () => {
    const s = toApprovalSettings({ invoiceApprovalAbove: '5000.00', billApprovalAbove: '2500', autoPostToleratedBills: false, paymentAutoApproveUpTo: '0' });
    expect(invoiceNeedsApproval(s, d('4999.99'))).toBe(false);
    expect(invoiceNeedsApproval(s, d('5000.00'))).toBe(true);
    expect(billPostsOnSave(s, { hasPurchaseOrder: false, matchStatus: 'NOT_RUN', total: d('2499.99') })).toBe(true);
    expect(billPostsOnSave(s, { hasPurchaseOrder: false, matchStatus: 'NOT_RUN', total: d('2500') })).toBe(false);
    // A zero limit approves no payment on Save.
    expect(paymentApprovedOnSave(s, d('0.01'))).toBe(false);
  });

  it('posts a PO bill on Save only on an exact match, unless tolerated matches are allowed', () => {
    const exactOnly = DEFAULT_APPROVAL_SETTINGS;
    const tolerant = { ...DEFAULT_APPROVAL_SETTINGS, autoPostToleratedBills: true };
    const bill = (matchStatus: string) => ({ hasPurchaseOrder: true, matchStatus, total: d('100') });
    expect(billPostsOnSave(exactOnly, bill('MATCHED'))).toBe(true);
    expect(billPostsOnSave(exactOnly, bill('MATCHED_WITH_TOLERANCE'))).toBe(false);
    expect(billPostsOnSave(tolerant, bill('MATCHED_WITH_TOLERANCE'))).toBe(true);
    expect(billPostsOnSave(tolerant, bill('EXCEPTION'))).toBe(false);
  });

  it('lists every bad field at once', () => {
    expect(approvalSettingsProblems({ invoiceApprovalAbove: '12.345', billApprovalAbove: 'abc', autoPostToleratedBills: false, paymentAutoApproveUpTo: '-1' })).toHaveLength(3);
    expect(approvalSettingsProblems({ invoiceApprovalAbove: null, billApprovalAbove: '0', autoPostToleratedBills: true, paymentAutoApproveUpTo: '1000' })).toEqual([]);
  });
});
