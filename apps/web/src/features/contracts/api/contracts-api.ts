import type { BillingModel } from '@erp/types';

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
