import { describe, expect, it } from 'vitest';
import type { ApprovalItem } from '@erp/types';

import { approvalHref, daysWaiting } from './approval-href';

const item = (patch: Partial<ApprovalItem>): ApprovalItem => ({
  kind: 'JOURNAL',
  id: 'x1',
  title: 'JV',
  detail: null,
  amount: null,
  currencyCode: null,
  waitingSince: '2026-10-01T00:00:00.000Z',
  requestedByName: null,
  projectId: null,
  projectName: null,
  transactionType: null,
  ...patch,
});

describe('approvalHref', () => {
  it('opens each document on the page that holds its decision', () => {
    expect(approvalHref(item({ kind: 'JOURNAL' }))).toBe('/finance/accounting/journals/x1');
    expect(approvalHref(item({ kind: 'BILL' }))).toBe('/finance/accounting/bills/x1');
    expect(approvalHref(item({ kind: 'QUOTATION' }))).toBe('/finance/quotes/x1');
    expect(approvalHref(item({ kind: 'MATERIAL_REQUEST' }))).toBe('/procurement/requests/x1');
    expect(approvalHref(item({ kind: 'PROGRESS_REPORT', projectId: 'p1' }))).toBe('/projects/p1/progress/review');
    expect(approvalHref(item({ kind: 'WORKFLOW', transactionType: 'PURCHASE_ORDER' }))).toBe('/procurement/orders/x1');
  });

  it('gives no link when the page needs more than the id', () => {
    expect(approvalHref(item({ kind: 'WORKFLOW', transactionType: 'VARIATION' }))).toBeNull();
    expect(approvalHref(item({ kind: 'PROGRESS_REPORT', projectId: null }))).toBeNull();
  });
});

describe('daysWaiting', () => {
  it('counts whole days, never negative', () => {
    expect(daysWaiting('2026-10-01T00:00:00.000Z', new Date('2026-10-04T12:00:00.000Z'))).toBe(3);
    expect(daysWaiting('2026-10-05T00:00:00.000Z', new Date('2026-10-04T00:00:00.000Z'))).toBe(0);
  });
});
