import { Decimal } from '@prisma/client/runtime/library';

/**
 * CONST-COM-007 / A4 — Single authoritative IPC reconciliation policy.
 *
 * Every certificate total — line subtotal, gross certified, retention, advance recovery,
 * other deductions, and net certified — is derived here, decimal-safe, from one place.
 * The IPC service computes with this policy and persists the results; the frontend
 * displays the persisted backend numbers and MUST NOT rebuild accounting totals.
 *
 * Monetary values are Decimal to 2 places, matching the schema (Decimal(18,2)).
 */

export interface IpcLineInput {
  /** Certified amount for a single BOQ line (certifiedQuantity × unitRate), 2dp. */
  certifiedAmount: Decimal;
}

export type IpcDeductionCategory = 'RETENTION' | 'ADVANCE_RECOVERY' | 'OTHER';

export interface IpcDeductionInput {
  deductionType: string;
  amount: Decimal;
}

export interface IpcReconciliation {
  grossCertified: string;
  retention: string;
  advanceRecovery: string;
  otherDeductions: string;
  totalDeductions: string;
  netCertified: string;
}

export class IpcReconciliationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'IpcReconciliationError';
  }
}

const ZERO = new Decimal(0);

function categorize(deductionType: string): IpcDeductionCategory {
  if (deductionType === 'RETENTION') return 'RETENTION';
  if (deductionType === 'ADVANCE_RECOVERY') return 'ADVANCE_RECOVERY';
  return 'OTHER';
}

/**
 * Reconcile a certificate from its lines and deductions.
 *
 * Invariants enforced (throws IpcReconciliationError on violation):
 *  - no line or deduction amount may be negative
 *  - net certified (gross − total deductions) may not be negative
 *
 * The header gross always equals the line sum by construction (we derive it here), which
 * is exactly the CONST-COM-007 guarantee: totals are never supplied independently.
 */
export function reconcileCertificate(
  lines: readonly IpcLineInput[],
  deductions: readonly IpcDeductionInput[],
): IpcReconciliation {
  let gross = ZERO;
  for (const line of lines) {
    if (line.certifiedAmount.isNegative()) {
      throw new IpcReconciliationError(
        'Certified line amount cannot be negative',
        'IPC_LINE_NEGATIVE',
      );
    }
    gross = gross.plus(line.certifiedAmount);
  }

  let retention = ZERO;
  let advanceRecovery = ZERO;
  let other = ZERO;
  for (const ded of deductions) {
    if (ded.amount.isNegative()) {
      throw new IpcReconciliationError(
        `Deduction amount cannot be negative (${ded.deductionType})`,
        'IPC_DEDUCTION_NEGATIVE',
      );
    }
    switch (categorize(ded.deductionType)) {
      case 'RETENTION':
        retention = retention.plus(ded.amount);
        break;
      case 'ADVANCE_RECOVERY':
        advanceRecovery = advanceRecovery.plus(ded.amount);
        break;
      default:
        other = other.plus(ded.amount);
    }
  }

  const totalDeductions = retention.plus(advanceRecovery).plus(other);
  const net = gross.minus(totalDeductions);

  if (net.isNegative()) {
    throw new IpcReconciliationError(
      `Net certified cannot be negative: gross ${gross.toFixed(2)} − deductions ${totalDeductions.toFixed(2)}`,
      'IPC_NET_NEGATIVE',
    );
  }

  return {
    grossCertified: gross.toFixed(2),
    retention: retention.toFixed(2),
    advanceRecovery: advanceRecovery.toFixed(2),
    otherDeductions: other.toFixed(2),
    totalDeductions: totalDeductions.toFixed(2),
    netCertified: net.toFixed(2),
  };
}
