import { PaymentTrigger } from '@erp/types';

import type {
  CreateContractPayload,
  PaymentInstallmentPayload,
  UpdateContractPayload,
} from './api/contracts-api';
import type { Contract } from './types';
import { BillingModel } from './types';

/**
 * One payment-plan row as the form holds it — every field a string, as HTML inputs produce.
 *
 * ADR-030 payment-schedule redesign: the row carries no trigger dropdown and no milestone
 * label (ACCO bills only on verified stages, and the stage `name` is its own label). Instead
 * the advance/milestone classification is a single explicit choice — `isAdvance` marks THE one
 * stage paid as the mobilization advance (at most one; zero is allowed for a no-advance
 * contract). `buildPaymentPlan` maps it to `triggerType` on the wire. What the user sets per
 * stage is the name, the percent, whether it is the advance, and an optional calendar `dueDate`.
 */
export interface PaymentPlanRow {
  name: string;
  /** Whole percent, e.g. "40" for 40%. Converted to a 0..1 fraction on the wire. */
  percentage: string;
  /** This stage is the mobilization advance (→ ADVANCE trigger). At most one row is true. */
  isAdvance: boolean;
  /** Calendar date (`YYYY-MM-DD`) the stage is expected to be billed by. Optional. */
  dueDate: string;
}

export const EMPTY_PAYMENT_PLAN_ROW: PaymentPlanRow = {
  name: '',
  percentage: '',
  isAdvance: false,
  dueDate: '',
};

/** What the form holds — every field a string, as HTML inputs produce. */
export interface ContractFormValues {
  projectId: string;
  clientId: string;
  boqVersionId: string;
  contractNumber: string;
  contractValue: string;
  currency: string;
  billingModel: string;
  startDate: string;
  expectedEndDate: string;
  /** ADR-023 payment schedule. Only sent for a MILESTONE contract at creation. */
  paymentPlan: PaymentPlanRow[];
}

export const EMPTY_CONTRACT_FORM: ContractFormValues = {
  projectId: '',
  clientId: '',
  boqVersionId: '',
  contractNumber: '',
  contractValue: '',
  // ACCO operates in USD only (contract-creation-form-spec §"Fixed USD"); the form no longer
  // offers a currency picker, so a new contract always starts — and stays — USD.
  currency: 'USD',
  billingModel: BillingModel.MEASURED_IPC,
  startDate: '',
  expectedEndDate: '',
  paymentPlan: [],
};

/**
 * Parses a whole-percent form string to a 0..1 fraction rounded to 4 dp, or `null` when it is
 * not a usable number. 4 dp because the column and DTO are Decimal(5,4): "40" → 0.4,
 * "33.33" → 0.3333. Returns null (not 0) on a bad value so a typo cannot silently reconcile.
 */
export function percentToFraction(percent: string): number | null {
  const trimmed = percent.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 100) * 10_000) / 10_000;
}

/** Sum of the plan's whole percents, ignoring rows whose percent is not a number. */
export function paymentPlanTotalPercent(rows: PaymentPlanRow[]): number {
  return rows.reduce((sum, row) => {
    const n = Number(row.percentage.trim());
    return Number.isFinite(n) && row.percentage.trim() ? sum + n : sum;
  }, 0);
}

/**
 * The indicative money value of one installment for the live preview: `percent × contractValue`.
 *
 * Display-only — the server computes the authoritative amount from the frozen base value at
 * billing time. Returns `null` when the percent or the value is not a usable number (so the
 * caller shows a dash, not `$NaN`). A JS number is acceptable here precisely because it never
 * reaches the wire: the plan's percentages, not this figure, are what is sent.
 */
export function installmentAmount(
  percent: string,
  contractValue: string | number | null,
): number | null {
  const fraction = percentToFraction(percent);
  if (fraction === null) return null;
  // A blank / whitespace value trims to '' and would coerce to 0 (a finite number) — treat it as
  // "no value" (null) rather than a real zero, so the row shows a dash, not `$0.00`.
  const str = typeof contractValue === 'number' ? String(contractValue) : (contractValue ?? '').trim();
  if (str === '') return null;
  const value = Number(str);
  if (!Number.isFinite(value)) return null;
  return Math.round(fraction * value * 100) / 100;
}

/**
 * Turns a stored 0..1 fraction back into the form's whole-percent string — the inverse of
 * `percentToFraction`. `"0.4000"` → `"40"`, `"0.3333"` → `"33.33"`. Trailing zeros are dropped so a
 * pre-populated row reads the way a user would type it, and a non-number degrades to `""` (a blank
 * the validator then flags) rather than `"NaN"`.
 */
export function fractionToPercentString(fraction: string | number): string {
  const n = typeof fraction === 'number' ? fraction : Number(String(fraction).trim());
  if (!Number.isFinite(n)) return '';
  // 2 dp mirrors the form's own ≤2-dp percent rule; `Number()` then strips trailing zeros.
  return String(Number((n * 100).toFixed(2)));
}

/**
 * Rebuilds an editable {@link PaymentPlanRow} from a read-model installment so the Payment Schedule
 * editor opens pre-populated from the current plan (the user adjusts the existing tail, not a blank
 * slate). The read model carries a fraction and a nullable calendar due date; this maps them back to
 * the string-per-field shape HTML inputs need. Structural fields only — the milestone *link* is
 * re-established through the dedicated link route, not this form, and the trigger is re-derived on
 * save from row position.
 */
export function paymentPlanRowFromInstallment(installment: {
  name: string;
  percentage: string;
  triggerType: string;
  dueDate: string | null;
}): PaymentPlanRow {
  return {
    name: installment.name,
    percentage: fractionToPercentString(installment.percentage),
    isAdvance: installment.triggerType === 'ADVANCE',
    dueDate: toDateInputValue(installment.dueDate),
  };
}

/**
 * Maps the form's plan rows to `POST /contracts` (and `PUT /payment-plan`) installment bodies.
 *
 * `sortOrder` is the row's position (1-based). `percentage` becomes a 0..1 fraction. The trigger
 * is the row's explicit `isAdvance` choice, not a position rule: the stage the user marks as the
 * advance becomes ADVANCE, every other stage is a MILESTONE — ACCO never bills on a time trigger, so
 * TIME_BASED is never produced. `allowAdvance` gates whether these rows may designate an advance at
 * all: true on a create or DRAFT full-replace; false on an ACTIVE re-profile, where the advance is
 * already invoiced and frozen, so the editable tail is entirely milestones regardless of any stale
 * flag. An empty `dueDate` is omitted rather than sent as `""` (`@IsDateString()` 400s on empty).
 */
export function buildPaymentPlan(
  rows: PaymentPlanRow[],
  allowAdvance = true,
): PaymentInstallmentPayload[] {
  return rows.map((row, index) => {
    const isAdvance = row.isAdvance && allowAdvance;
    const installment: PaymentInstallmentPayload = {
      sortOrder: index + 1,
      name: row.name.trim(),
      percentage: percentToFraction(row.percentage) ?? 0,
      triggerType: isAdvance ? PaymentTrigger.ADVANCE : PaymentTrigger.MILESTONE,
    };

    const dueDate = row.dueDate.trim();
    if (dueDate) installment.dueDate = dueDate;

    return installment;
  });
}

/**
 * Normalizes a money string for the wire.
 *
 * Not required by the API — verified against the running server, which accepts
 * `"5000000"`, `"5000000.00"` and even the JSON number `5000000` (the global
 * ValidationPipe runs with `enableImplicitConversion`, so a number is coerced to a string
 * before `@IsDecimal()` sees it).
 *
 * It is done anyway for one reason: the column is Decimal(18,2) and Prisma serializes it
 * back with trailing zeros dropped, so a contract created as `"5000000"` reads back as
 * `"5000000"` while one created as `"5000000.00"` reads back unchanged. Pinning the scale
 * here keeps every contract's stored value the same shape regardless of how it was typed.
 *
 * Deliberately string-to-string: the amount never becomes a JS number, so it cannot pick
 * up a floating-point artefact between the form and the database.
 */
export function toDecimalString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const [whole = '0', fraction = ''] = trimmed.split('.');
  return `${whole || '0'}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/**
 * Converts form values into the `POST /contracts` body.
 *
 * The three identity fields are always sent — a contract without a project, a client and a
 * baselined BOQ version is not a contract, and the DTO marks all three `@IsNotEmpty()`.
 *
 * Empty optional dates are omitted rather than sent as `""`: `@IsDateString()` rejects an
 * empty string with a 400 the user cannot act on.
 */
export function toCreateContractPayload(values: ContractFormValues): CreateContractPayload {
  const payload: CreateContractPayload = {
    projectId: values.projectId,
    clientId: values.clientId,
    boqVersionId: values.boqVersionId,
    contractNumber: values.contractNumber.trim(),
    contractValue: toDecimalString(values.contractValue),
    currency: values.currency.trim(),
  };

  if (values.billingModel) payload.billingModel = values.billingModel as BillingModel;
  if (values.startDate.trim()) payload.startDate = values.startDate.trim();
  if (values.expectedEndDate.trim()) payload.expectedEndDate = values.expectedEndDate.trim();

  // The plan is only meaningful for a MILESTONE contract (the server rejects it on any other
  // model), so it is carried only then — and only when the user actually added rows.
  if (values.billingModel === BillingModel.MILESTONE && values.paymentPlan.length > 0) {
    payload.paymentPlan = buildPaymentPlan(values.paymentPlan);
  }

  return payload;
}

/**
 * The minimal create form's values (ADR-030 S-CC-5). The BOQ version, contract value and number are
 * no longer collected — C1 resolves the committed BOQ, ties the value out to it, and mints the
 * number server-side — so the browser sends only who the contract is with and when it runs.
 */
export interface MinimalCreateContractValues {
  projectId: string;
  clientId: string;
  billingModel: string;
  /** Inherited from the project on submit — the create form no longer collects dates (ADR-030). */
  startDate: string;
  expectedEndDate: string;
  /**
   * ADR-030 inline schedule — the MILESTONE plan seeded and edited in the create form. Sent only
   * for a MILESTONE contract (the server 400s a plan on any other model); this is the one chance to
   * seed the installments, as the plan has no PATCH (only a DRAFT-only replace).
   */
  paymentPlan?: PaymentPlanRow[];
}

/**
 * Builds the minimal `POST /contracts` body (S-CC-5 + ADR-030 inline schedule). Only project, client
 * and currency are always sent; `boqVersionId`, `contractValue` and `contractNumber` are deliberately
 * ABSENT so the server resolves the committed BOQ, ties the value out and mints the number
 * (CONST-COM-020..022).
 *
 * Dates are INHERITED from the project: the create form no longer shows date pickers, but the
 * contract still carries its own completion date for Extension-of-Time to extend. Empty inherited
 * dates are omitted rather than sent as `""` (`@IsDateString()` 400s on an empty string).
 *
 * The payment plan is carried only for a MILESTONE contract and only when rows were seeded.
 */
export function toMinimalCreateContractPayload(
  values: MinimalCreateContractValues,
): CreateContractPayload {
  const payload: CreateContractPayload = {
    projectId: values.projectId,
    clientId: values.clientId,
    // ACCO operates in USD only; the value ties out to the committed BOQ, but currency is still a
    // required field on the DTO.
    currency: 'USD',
  };

  if (values.billingModel) payload.billingModel = values.billingModel as BillingModel;
  if (values.startDate.trim()) payload.startDate = values.startDate.trim();
  if (values.expectedEndDate.trim()) payload.expectedEndDate = values.expectedEndDate.trim();

  if (values.billingModel === BillingModel.MILESTONE && (values.paymentPlan?.length ?? 0) > 0) {
    payload.paymentPlan = buildPaymentPlan(values.paymentPlan ?? []);
  }

  return payload;
}

/**
 * Converts form values into a `PATCH /contracts/:id` body.
 *
 * Unlike clients, a cleared date is OMITTED rather than sent as `null`, because on this
 * endpoint `null` achieves nothing: the service maps each date with
 * `dto.startDate ? new Date(dto.startDate) : undefined` (`contract.service.ts:104-105`),
 * so a null falls through to `undefined` and Prisma skips the column entirely.
 *
 * Verified against the running API — a `PATCH` sending `{"startDate": null}` on a contract
 * dated 2026-03-01 returns it still dated 2026-03-01. No error, no change: a silent no-op.
 *
 * So contract dates are set-or-leave rather than set-or-clear. Sending `null` anyway would
 * be worse than omitting: it would read like an attempt to clear the field, and every
 * future reader would have to rediscover that it does nothing.
 */
export function toUpdateContractPayload(values: ContractFormValues): UpdateContractPayload {
  const payload: UpdateContractPayload = {
    contractNumber: values.contractNumber.trim(),
    contractValue: toDecimalString(values.contractValue),
    currency: values.currency.trim(),
  };

  if (values.billingModel) payload.billingModel = values.billingModel as BillingModel;
  if (values.startDate.trim()) payload.startDate = values.startDate.trim();
  if (values.expectedEndDate.trim()) payload.expectedEndDate = values.expectedEndDate.trim();

  return payload;
}

/** Fills the form from an existing contract, converting nulls to the strings inputs need. */
export function toContractFormValues(contract: Contract): ContractFormValues {
  return {
    projectId: contract.projectId,
    clientId: contract.clientId,
    boqVersionId: contract.boqVersionId,
    contractNumber: contract.contractNumber,
    contractValue: contract.contractValue,
    currency: contract.currency,
    billingModel: contract.billingModel,
    // Date inputs need `YYYY-MM-DD`; the API sends a full ISO timestamp.
    startDate: toDateInputValue(contract.startDate),
    expectedEndDate: toDateInputValue(contract.expectedEndDate),
    // The plan is create-only (no PATCH), so an existing contract never repopulates it.
    paymentPlan: [],
  };
}

function toDateInputValue(value: string | null): string {
  return value ? (value.split('T')[0] ?? '') : '';
}
