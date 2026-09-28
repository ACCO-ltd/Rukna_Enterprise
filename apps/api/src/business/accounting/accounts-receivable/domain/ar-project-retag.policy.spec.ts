import { Decimal } from '@prisma/client/runtime/library';

import {
  correctionLines,
  expectedProjectDeltas,
  projectRevenueEffect,
  proveRetag,
  retagFingerprint,
  retagSourceId,
  retagStatus,
  type RetagLine,
} from './ar-project-retag.policy.js';

function line(overrides: Partial<RetagLine> = {}): RetagLine {
  return {
    lineId: 'l1',
    lineNumber: 2,
    journalEntryId: 'je-rev',
    journalNumber: 'JE-0042',
    accountingDate: '2026-09-10',
    periodId: 'p9',
    periodName: 'Sep 2026',
    periodStatus: 'OPEN',
    accountId: 'rev',
    accountCode: '40100',
    accountName: 'Project revenue',
    debit: '1000.00',
    credit: '0.00',
    clientId: 'c1',
    contractId: 'k1',
    sourceKind: 'INVOICE_REVERSAL',
    sourceInvoiceId: 'inv1',
    sourceInvoiceNumber: 'INV-0007',
    creditNoteId: null,
    creditNoteNumber: null,
    intendedProjectId: 'proj-A',
    intendedProjectCode: 'ACCO-A',
    alreadyCorrected: false,
    priorCorrections: 0,
    ...overrides,
  };
}

describe('AR project-tag reclassification policy', () => {
  it('builds a balanced pair in the same account that only moves the project', () => {
    const [tagged, cleared] = correctionLines(line());
    expect(tagged).toMatchObject({ accountId: 'rev', projectId: 'proj-A', clientId: 'c1', contractId: 'k1' });
    expect(tagged!.debitAmount.toString()).toBe('1000');
    expect(cleared).toMatchObject({ accountId: 'rev', projectId: null, clientId: 'c1', contractId: 'k1' });
    expect(cleared!.creditAmount.toString()).toBe('1000');
    const debits = tagged!.debitAmount.plus(cleared!.debitAmount);
    const credits = tagged!.creditAmount.plus(cleared!.creditAmount);
    expect(debits.equals(credits)).toBe(true);
  });

  it('takes the missed reversal off the project’s revenue', () => {
    expect(projectRevenueEffect(line()).toString()).toBe('-1000');
    const deltas = expectedProjectDeltas([line(), line({ lineId: 'l2', debit: '250.00' })]);
    expect(deltas.get('proj-A')!.toString()).toBe('-1250');
  });

  it('never posts silently into a closed or locked period, and skips corrected lines', () => {
    expect(retagStatus(line())).toBe('READY');
    expect(retagStatus(line({ periodStatus: 'REOPENED' }))).toBe('READY');
    expect(retagStatus(line({ periodStatus: 'CLOSED' }))).toBe('BLOCKED_PERIOD');
    expect(retagStatus(line({ periodStatus: 'LOCKED' }))).toBe('BLOCKED_PERIOD');
    expect(retagStatus(line({ alreadyCorrected: true }))).toBe('ALREADY_CORRECTED');
  });

  it('keys each correction to its line, so a re-run is a no-op', () => {
    expect(retagSourceId('l1')).toBe('ar-project-retag:l1');
    // A correction that was later reversed no longer counts; the next one gets its own key.
    expect(retagSourceId('l1', 1)).toBe('ar-project-retag:l1:v2');
  });

  it('fingerprints what was approved, independent of order and sensitive to amounts', () => {
    const a = retagFingerprint([line(), line({ lineId: 'l2' })]);
    expect(retagFingerprint([line({ lineId: 'l2' }), line()])).toBe(a);
    expect(retagFingerprint([line({ debit: '999.00' }), line({ lineId: 'l2' })])).not.toBe(a);
  });

  describe('proof', () => {
    const d = (v: string) => new Decimal(v);
    const base = {
      accountNetBefore: new Map([['rev', d('-5000')]]),
      accountNetAfter: new Map([['rev', d('-5000')]]),
      projectRevenueBefore: new Map([['proj-A', d('3000')], ['proj-B', d('2000')], ['', d('-1000')]]),
      expectedDeltas: new Map([['proj-A', d('-1000')]]),
    };

    it('passes when only the affected project and the untagged bucket move, by the expected amount', () => {
      const proof = proveRetag({
        ...base,
        projectRevenueAfter: new Map([['proj-A', d('2000')], ['proj-B', d('2000')], ['', d('0')]]),
      });
      expect(proof).toEqual({ ok: true, failures: [] });
    });

    it('fails if an unaffected project moves or an account total changes', () => {
      const proof = proveRetag({
        ...base,
        accountNetAfter: new Map([['rev', d('-4000')]]),
        projectRevenueAfter: new Map([['proj-A', d('2000')], ['proj-B', d('1900')], ['', d('0')]]),
      });
      expect(proof.ok).toBe(false);
      expect(proof.failures.join('\n')).toMatch(/Account rev net changed/);
      expect(proof.failures.join('\n')).toMatch(/proj-B/);
    });
  });
});
