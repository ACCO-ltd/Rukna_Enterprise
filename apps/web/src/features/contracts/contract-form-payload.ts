import type { CreateContractPayload, UpdateContractPayload } from './api/contracts-api';
import type { Contract } from './types';
import { BillingModel } from './types';

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
}

export const EMPTY_CONTRACT_FORM: ContractFormValues = {
  projectId: '',
  clientId: '',
  boqVersionId: '',
  contractNumber: '',
  contractValue: '',
  currency: '',
  billingModel: BillingModel.MEASURED_IPC,
  startDate: '',
  expectedEndDate: '',
};

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
  };
}

function toDateInputValue(value: string | null): string {
  return value ? (value.split('T')[0] ?? '') : '';
}
