import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-026 (Variations Phase 1) — the pure VariationOrder domain.
 *
 * This module carries ZERO infrastructure (no Prisma, no Nest). It owns two things the rest of the
 * aggregate reads from:
 *
 *  1. The guarded-command state machine (CONST-VAR-004): which lifecycle command is legal from
 *     which status, whether figures are still editable, and whether a status is terminal / counts
 *     toward the governing or pending contract value.
 *  2. The derived-total math (CONST-VAR-002/-005/-006): the signed line amount, a VO's net price,
 *     and the four contract-value figures (original / approved / governing / pending).
 *
 * Statuses are plain strings (the Prisma enum's members) so the policy is unit-testable directly
 * and never drags the generated client into a test.
 */

export type VariationOrderStatusValue =
  | 'DRAFT'
  | 'PENDING_INTERNAL'
  | 'INTERNAL_APPROVED'
  | 'CLIENT_APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type VariationOrderCommand =
  | 'submit'
  | 'internalApprove'
  | 'clientApprove'
  | 'reject'
  | 'withdraw';

export interface TransitionDecision {
  allowed: boolean;
  /** Machine-stable reason code, present only when allowed === false. */
  reason?: string;
  /** The status the command moves the VO into, present only when allowed === true. */
  to?: VariationOrderStatusValue;
}

// Terminal states — commercially inert, retained for audit (CONST-VAR-004).
const TERMINAL: ReadonlySet<VariationOrderStatusValue> = new Set<VariationOrderStatusValue>([
  'CLIENT_APPROVED',
  'REJECTED',
  'WITHDRAWN',
]);

// The single legal transition table. Each command names its required from-status and its target.
// `reject` and `withdraw` are handled specially (multiple valid from-states), below.
const FORWARD: Record<
  Exclude<VariationOrderCommand, 'reject' | 'withdraw'>,
  { from: VariationOrderStatusValue; to: VariationOrderStatusValue }
> = {
  submit: { from: 'DRAFT', to: 'PENDING_INTERNAL' },
  internalApprove: { from: 'PENDING_INTERNAL', to: 'INTERNAL_APPROVED' },
  clientApprove: { from: 'INTERNAL_APPROVED', to: 'CLIENT_APPROVED' },
};

// CONST-VAR-004: reject is legal from any pre-client, non-terminal state.
const REJECTABLE_FROM: ReadonlySet<VariationOrderStatusValue> = new Set<VariationOrderStatusValue>([
  'DRAFT',
  'PENDING_INTERNAL',
  'INTERNAL_APPROVED',
]);

// Withdraw is retraction by ACCO before a decision — same pre-client, non-terminal set.
const WITHDRAWABLE_FROM: ReadonlySet<VariationOrderStatusValue> =
  new Set<VariationOrderStatusValue>(['DRAFT', 'PENDING_INTERNAL', 'INTERNAL_APPROVED']);

export const VariationOrderPolicy = {
  /**
   * Decide whether `command` is legal for a VO currently in `status`. Pure and exhaustive so it
   * can back both the service guard and (later) a Gate-B capability projection.
   */
  evaluateTransition(
    status: VariationOrderStatusValue,
    command: VariationOrderCommand,
  ): TransitionDecision {
    if (command === 'reject') {
      return REJECTABLE_FROM.has(status)
        ? { allowed: true, to: 'REJECTED' }
        : { allowed: false, reason: `CANNOT_REJECT_FROM_${status}` };
    }
    if (command === 'withdraw') {
      return WITHDRAWABLE_FROM.has(status)
        ? { allowed: true, to: 'WITHDRAWN' }
        : { allowed: false, reason: `CANNOT_WITHDRAW_FROM_${status}` };
    }

    const step = FORWARD[command];
    if (status !== step.from) {
      return { allowed: false, reason: `EXPECTED_${step.from}_GOT_${status}` };
    }
    return { allowed: true, to: step.to };
  },

  /**
   * CONST-VAR-004 / -010: field editing (lines, title, proposed figures) is only open while a VO is
   * a DRAFT. It closes at PENDING_INTERNAL (the VO is under governance) and never reopens; figures
   * freeze for good at INTERNAL_APPROVED. So "may edit fields" ⇔ status is DRAFT.
   */
  fieldsEditable(status: VariationOrderStatusValue): boolean {
    return status === 'DRAFT';
  },

  isTerminal(status: VariationOrderStatusValue): boolean {
    return TERMINAL.has(status);
  },

  /** CONST-VAR-005: only a CLIENT_APPROVED VO counts toward the governing contract value. */
  countsTowardGoverning(status: VariationOrderStatusValue): boolean {
    return status === 'CLIENT_APPROVED';
  },

  /**
   * CONST-VAR-006: the Pending total is PENDING_INTERNAL + INTERNAL_APPROVED only. DRAFT is not yet
   * counted anywhere; the terminals (REJECTED / WITHDRAWN) are inert; CLIENT_APPROVED has graduated
   * to the governing value and so is excluded here (never double-counted).
   */
  countsTowardPending(status: VariationOrderStatusValue): boolean {
    return status === 'PENDING_INTERNAL' || status === 'INTERNAL_APPROVED';
  },
} as const;

// ─── Derived-total math (CONST-VAR-002/-005/-006) ───────────────────────────────

export interface VariationLineAmountInput {
  quantity: Decimal | string | number;
  unitRate: Decimal | string | number;
}

/**
 * CONST-VAR-002: a line's signed amount = quantity × unitRate, at money precision (2dp). A negative
 * quantity yields a negative amount — the way an omission is expressed. Rounding is applied once,
 * here, so the stored `amount` and any re-derivation agree to the cent.
 */
export function lineAmount(line: VariationLineAmountInput): Decimal {
  const qty = new Decimal(line.quantity);
  const rate = new Decimal(line.unitRate);
  return qty.mul(rate).toDecimalPlaces(2);
}

/** CONST-VAR-002: a VO's proposed net price = Σ line amounts. Signed; may be negative. */
export function netPrice(lines: Array<{ amount: Decimal | string | number }>): Decimal {
  return lines
    .reduce((sum, l) => sum.plus(new Decimal(l.amount)), new Decimal(0))
    .toDecimalPlaces(2);
}

export interface VariationForValuation {
  status: VariationOrderStatusValue;
  netPrice: Decimal | string | number;
}

export interface ContractValueFigures {
  original: Decimal;
  approvedVariationsTotal: Decimal;
  governing: Decimal;
  pending: Decimal;
}

/**
 * CONST-VAR-005/-006/-006a: derive the four contract-value figures from the original baseline and
 * the VO set. `original` is never mutated (it is `Contract.contractValue`); everything else is
 * computed here so the read model can never disagree with the aggregate.
 *
 *   approvedVariationsTotal = Σ net of CLIENT_APPROVED   (omissions subtract; may be negative)
 *   governing               = original + approvedVariationsTotal
 *   pending                 = Σ net of PENDING_INTERNAL + INTERNAL_APPROVED   (never folded in)
 */
export function deriveContractValue(
  original: Decimal | string | number,
  variations: VariationForValuation[],
): ContractValueFigures {
  const originalDec = new Decimal(original).toDecimalPlaces(2);
  let approved = new Decimal(0);
  let pending = new Decimal(0);

  for (const v of variations) {
    const net = new Decimal(v.netPrice);
    if (VariationOrderPolicy.countsTowardGoverning(v.status)) {
      approved = approved.plus(net);
    } else if (VariationOrderPolicy.countsTowardPending(v.status)) {
      pending = pending.plus(net);
    }
  }

  approved = approved.toDecimalPlaces(2);
  pending = pending.toDecimalPlaces(2);

  return {
    original: originalDec,
    approvedVariationsTotal: approved,
    governing: originalDec.plus(approved).toDecimalPlaces(2),
    pending,
  };
}
