import type { AdvanceType, BillingModel, GuaranteeStatus, PaymentTrigger } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type { ContractCommand } from '../contract-actions';
import type { Contract, ContractDetail } from '../types';

/**
 * Body accepted by `POST /contracts`, mirroring CreateContractDto.
 *
 * `contractValue` is a STRING here, unlike the project form where it is a number.
 * `CreateProjectDto` declares `@IsNumber` while `CreateContractDto` declares `@IsDecimal`.
 * The endpoint would in fact accept a number too — the ValidationPipe's
 * `enableImplicitConversion` coerces it first, verified against the running server — but
 * a string is the right shape for money regardless: the value never passes through a JS
 * `double` on its way to a Decimal(18,2) column.
 *
 * `boqVersionId` must reference a BASELINED version belonging to `projectId` — the server
 * checks both (`contract.service.ts:50-63`) and the picker filters to match.
 */
export interface CreateContractPayload {
  projectId: string;
  clientId: string;
  boqVersionId: string;
  contractNumber: string;
  contractValue: string;
  currency: string;
  billingModel?: BillingModel;
  startDate?: string;
  expectedEndDate?: string;
  /**
   * ADR-023 payment schedule — only accepted at creation, and only for a MILESTONE contract
   * (the server 400s a plan on any other billing model). Optional even for MILESTONE; when
   * present the percentages must reconcile to 100% (CONST-COM-012). There is no PATCH for it,
   * so this is the one chance to seed the installments.
   */
  paymentPlan?: PaymentInstallmentPayload[];
}

/**
 * One installment in `POST /contracts` `paymentPlan`, mirroring PaymentInstallmentDto.
 *
 * `percentage` is a FRACTION (0..1, ≤4 dp), e.g. 0.4 for 40% — the form collects whole
 * percents and converts. `dueOffsetDays`/`dueDate` are alternatives; a TIME_BASED installment
 * needs one of them. Amount is derived server-side (percentage × contract value), never sent.
 */
export interface PaymentInstallmentPayload {
  sortOrder: number;
  name: string;
  percentage: number;
  triggerType: `${PaymentTrigger}`;
  dueOffsetDays?: number;
  dueDate?: string;
  milestoneLabel?: string;
}

/**
 * Body accepted by `PATCH /contracts/:id`, which the API allows only while DRAFT.
 *
 * `projectId`, `clientId` and `boqVersionId` are absent: `UpdateContractDto` does not
 * declare them, so what a contract is *for* is fixed at creation. Only its commercial
 * terms can be corrected.
 *
 * Unlike clients and projects, `contractNumber` IS editable — a mistyped reference can be
 * fixed while the contract is still a draft.
 *
 * Every field is `@IsOptional()` without a nullable column behind it, so `null` is not
 * used here — see `toUpdateContractPayload`.
 */
export interface UpdateContractPayload {
  contractNumber?: string;
  contractValue?: string;
  currency?: string;
  billingModel?: BillingModel;
  startDate?: string;
  expectedEndDate?: string;
}

/** `GET /contracts`, optionally scoped to one project. Newest first. */
export function listContracts(projectId?: string): Promise<Contract[]> {
  return apiClient<Contract[]>('/contracts', {
    ...(projectId ? { params: { projectId } } : {}),
  });
}

/** Returns the contract with retention terms, advances, guarantees and milestones. */
export function getContract(id: string): Promise<ContractDetail> {
  return apiClient<ContractDetail>(`/contracts/${id}`);
}

export function createContract(payload: CreateContractPayload): Promise<Contract> {
  return apiClient<Contract>('/contracts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateContract(id: string, payload: UpdateContractPayload): Promise<Contract> {
  return apiClient<Contract>(`/contracts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Advances the contract one step. Returns the updated contract. */
export function runContractCommand(id: string, command: ContractCommand): Promise<Contract> {
  return apiClient<Contract>(`/contracts/${id}/${command}`, { method: 'POST' });
}

/**
 * Cancels a contract that has not yet been executed.
 *
 * `reason` is REQUIRED by the DTO (`@IsNotEmpty`, max 500) and then discarded — the
 * service does `void reason; // audit trail deferred to Phase 4 AuditLog`
 * (`contract.service.ts:143`) and no column on `Contract` holds it. The UI must therefore
 * not tell the user their explanation is being recorded, because it is not. Raised as C13.
 */
export function cancelContract(id: string, reason: string): Promise<Contract> {
  return apiClient<Contract>(`/contracts/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/** Terminates an ACTIVE contract. `reason` is required and discarded — see `cancelContract`. */
export function terminateContract(id: string, reason: string): Promise<Contract> {
  return apiClient<Contract>(`/contracts/${id}/terminate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ─── Commercial terms ────────────────────────────────────────────────────────────
//
// None of the endpoints below is gated on contract status: the service calls
// `requireContract` and nothing else, so the API would attach a new advance term to a
// contract cancelled last year. `canEditTerms` in `contract-terms.ts` is the UI's own
// guard, and it is stated as such there.

/**
 * Sets or replaces the retention terms. Upsert — there is at most one per contract, keyed
 * on `contractId`, so sending this twice corrects rather than duplicates.
 *
 * ⚠ `retentionSplitOnPc` — lowercase `c`. The RESPONSE spells the same field
 * `retentionSplitOnPC`. Echoing the response shape back is a 400
 * (`property retentionSplitOnPC should not exist`), verified against the running API.
 * Raised as C10.
 *
 * All three rates are Decimal(5,4) FRACTIONS: 5% is `"0.0500"`. See `contract-terms.ts`.
 */
export interface SetRetentionTermsPayload {
  retentionRate: string;
  retentionCap: string;
  retentionSplitOnPc: string;
  retentionReleasedAt?: string;
}

export function setRetentionTerms(
  contractId: string,
  payload: SetRetentionTermsPayload,
): Promise<unknown> {
  return apiClient(`/contracts/${contractId}/retention-terms`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * `amount` and `percentage` are alternatives. The DTO marks both optional and enforces no
 * relationship, so the API accepts a term with both or with neither — the form requires
 * exactly one, because a term with neither cannot be priced.
 *
 * `recoveryRate` is a Decimal(5,4) fraction: 10% recovered per certificate is `"0.1000"`.
 */
export interface AddAdvanceTermPayload {
  advanceType: AdvanceType;
  description?: string;
  amount?: string;
  percentage?: string;
  recoveryRate: string;
}

export function addAdvanceTerm(
  contractId: string,
  payload: AddAdvanceTermPayload,
): Promise<unknown> {
  return apiClient(`/contracts/${contractId}/advance-terms`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Removes an advance term.
 *
 * The API deletes by `termId` alone without checking it belongs to `contractId`
 * (`contract-prisma.repository.ts`), the same scoping gap as C11. Our calls always pass a
 * term read from this contract, so they are correct — recorded because the guard is
 * missing, not because we rely on it.
 */
export function removeAdvanceTerm(contractId: string, termId: string): Promise<void> {
  return apiClient<void>(`/contracts/${contractId}/advance-terms/${termId}`, { method: 'DELETE' });
}

/** `guaranteeType` is free text, not an enum — the backend does not constrain it. */
export interface AddGuaranteePayload {
  guaranteeType: string;
  amount: string;
  currency: string;
  issuer: string;
  beneficiary: string;
  issueDate: string;
  expiryDate: string;
  notes?: string;
}

export function addGuarantee(
  contractId: string,
  payload: AddGuaranteePayload,
): Promise<unknown> {
  return apiClient(`/contracts/${contractId}/guarantees`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Only status and notes are updatable — the commercial facts of a guarantee are fixed. */
export function updateGuarantee(
  contractId: string,
  guaranteeId: string,
  payload: { status?: GuaranteeStatus; notes?: string },
): Promise<unknown> {
  return apiClient(`/contracts/${contractId}/guarantees/${guaranteeId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export interface AddMilestonePayload {
  name: string;
  description?: string;
  dueDate?: string;
  sortOrder?: number;
}

export function addMilestone(
  contractId: string,
  payload: AddMilestonePayload,
): Promise<unknown> {
  return apiClient(`/contracts/${contractId}/milestones`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Stamps `completedAt` and `completedBy` from the token. There is no un-complete. */
export function completeMilestone(contractId: string, milestoneId: string): Promise<unknown> {
  return apiClient(`/contracts/${contractId}/milestones/${milestoneId}/complete`, {
    method: 'POST',
  });
}

// ─── Payment-schedule installments (ADR-023 MILESTONE contracts) ───────────────────

/**
 * `PATCH /contracts/:id/installments/:installmentId/milestone` — link or unlink a programme
 * milestone as a payment installment's billing evidence (CONST-COM-011).
 *
 * Pass a `programmeMilestoneId` to link; pass `null` to unlink. Once linked and unverified, the
 * server refuses to invoice the installment until the milestone is verified.
 */
export function setInstallmentMilestone(
  contractId: string,
  installmentId: string,
  programmeMilestoneId: string | null,
): Promise<unknown> {
  return apiClient(`/contracts/${contractId}/installments/${installmentId}/milestone`, {
    method: 'PATCH',
    body: JSON.stringify({ programmeMilestoneId }),
  });
}
