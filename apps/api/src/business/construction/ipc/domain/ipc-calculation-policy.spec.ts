import { Decimal } from '@prisma/client/runtime/library';

import {
  reconcileCertificate,
  IpcReconciliationError,
} from './ipc-calculation-policy.js';

const line = (amount: string) => ({ certifiedAmount: new Decimal(amount) });
const ded = (deductionType: string, amount: string) => ({ deductionType, amount: new Decimal(amount) });

describe('reconcileCertificate (CONST-COM-007)', () => {
  it('derives gross from the line sum and net from gross minus deductions', () => {
    const r = reconcileCertificate(
      [line('100.00'), line('250.50')],
      [ded('RETENTION', '35.05'), ded('ADVANCE_RECOVERY', '17.53'), ded('OTHER_PENALTY', '10.00')],
    );
    expect(r.grossCertified).toBe('350.50');
    expect(r.retention).toBe('35.05');
    expect(r.advanceRecovery).toBe('17.53');
    expect(r.otherDeductions).toBe('10.00');
    expect(r.totalDeductions).toBe('62.58');
    expect(r.netCertified).toBe('287.92');
  });

  it('is decimal-safe across many small lines (no float drift)', () => {
    const lines = Array.from({ length: 3 }, () => line('0.10'));
    const r = reconcileCertificate(lines, []);
    expect(r.grossCertified).toBe('0.30');
    expect(r.netCertified).toBe('0.30');
  });

  it('handles a zero certificate', () => {
    const r = reconcileCertificate([], []);
    expect(r.grossCertified).toBe('0.00');
    expect(r.netCertified).toBe('0.00');
  });

  it('rejects a negative line amount', () => {
    expect(() => reconcileCertificate([line('-1.00')], [])).toThrow(IpcReconciliationError);
    try {
      reconcileCertificate([line('-1.00')], []);
    } catch (e) {
      expect((e as IpcReconciliationError).code).toBe('IPC_LINE_NEGATIVE');
    }
  });

  it('rejects a negative deduction amount', () => {
    try {
      reconcileCertificate([line('100.00')], [ded('RETENTION', '-5.00')]);
      fail('expected throw');
    } catch (e) {
      expect((e as IpcReconciliationError).code).toBe('IPC_DEDUCTION_NEGATIVE');
    }
  });

  it('rejects deductions that exceed the gross (net would be negative)', () => {
    try {
      reconcileCertificate([line('100.00')], [ded('RETENTION', '150.00')]);
      fail('expected throw');
    } catch (e) {
      expect((e as IpcReconciliationError).code).toBe('IPC_NET_NEGATIVE');
    }
  });

  it('allows net to reach exactly zero', () => {
    const r = reconcileCertificate([line('100.00')], [ded('RETENTION', '100.00')]);
    expect(r.netCertified).toBe('0.00');
  });
});
