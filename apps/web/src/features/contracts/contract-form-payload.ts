import { PaymentTrigger } from '@erp/types';

import type {
  CreateContractPayload,
  PaymentInstallmentPayload,
  UpdateContractPayload,
} from './api/contracts-api';
import type { Contract } from './types';
import { BillingModel } from './types';

/** One payment-plan row as the form holds it — every field a string, as HTML inputs produce. */
export interface PaymentPlanRow {
  name: string;
  /** Whole percent, e.g. "40" for 40%. Converted to a 0..1 fraction on the wire. */
  percentage: string;
  triggerType: string;
  milestoneLabel: string;
  /** Days from contract start; only meaningful for a TIME_BASED trigger. */
  dueOffsetDays: string;
}

export const EMPTY_PAYMENT_PLAN_ROW: PaymentPlanRow = {
  name: '',
  percentage: '',
  triggerType: PaymentTrigger.MILESTONE,
  milestoneLabel: '',
  dueOffsetDays: '',
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
 * Maps the form's plan rows to `POST /contracts` installment bodies.
 *
 * `sortOrder` is the row's position (1-based). `percentage` becomes a 0..1 fraction. Optional
 * text/number fields are omitted when blank rather than sent empty — `@IsOptional()` on the DTO
 * treats a missing field and an absent one the same, and an empty `dueDate`/`dueOffsetDays`
 * would 400. `dueOffsetDays` is only carried for a TIME_BASED trigger.
 */
export function buildPaymentPlan(rows: PaymentPlanRow[]): PaymentInstallmentPayload[] {
  return rows.map((row, index) => {
    const installment: PaymentInstallmentPayload = {
      sortOrder: index + 1,
      name: row.name.trim(),
      percentage: percentToFraction(row.percentage) ?? 0,
      triggerType: row.triggerType as PaymentInstallmentPayload['triggerType'],
    };

    const label = row.milestoneLabel.trim();
    if (label) installment.milestoneLabel = label;

    if (row.triggerType === PaymentTrigger.TIME_BASED && row.dueOffsetDays.trim()) {
      const offset = Number(row.dueOffsetDays.trim());
      if (Number.isFinite(offset)) installment.dueOffsetDays = offset;
    }

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
