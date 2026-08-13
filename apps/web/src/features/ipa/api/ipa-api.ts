import { apiClient } from '@/lib/api-client';

import type { IpaCommand } from '../ipa-actions';
import type { Ipa, IpaDeduction, IpaDetail, IpaItem } from '../types';

/**
 * Body accepted by `POST /ipa`.
 *
 * Everything except `contractId` is optional. The exchange-rate fields are a snapshot
 * frozen at creation and are only meaningful on a contract billed in a currency other than
 * the one the books are kept in — they are not offered in the form until there is a rate
 * source to populate them from. Sending a partial set would record a rate with no base.
 */
export interface CreateIpaPayload {
  contractId: string;
  periodFrom?: string;
  periodTo?: string;
  notes?: string;
}

/**
 * Body accepted by `POST /ipa/:id/items`.
 *
 * ⚠ `unitRateSnapshot` is supplied by the CLIENT. `IpaService.addItem` already loads the
 * BOQ node one line earlier to snapshot its measurement method, and could take the rate
 * from the same row — but it does not, so whatever is sent here becomes the price this
 * line is claimed at. That is C3 (issue #10).
 *
 * The picker therefore sends the node's own `unitRate` verbatim and never lets the user
 * type one. When C3 lands, this field and the currency drop out of the payload and nothing
 * else changes.
 *
 * `cumulativeClaimed` is the total claimed TO DATE on this line, not this period's
 * quantity. The server derives the period figures from it by subtracting what the last
 * effective certificate certified (`ipa.service.ts:155-172`).
 */
export interface AddIpaItemPayload {
  boqNodeId: string;
  unitRateSnapshot: string;
  currencySnapshot: string;
  cumulativeClaimed: string;
}

/**
 * Body accepted by `POST /ipa/:id/deductions`.
 *
 * `basis` and `amount` are both required and both computed by the caller — the same shape
 * of problem as C1 on certificates, one document earlier in the chain. The API derives
 * nothing here even though the contract's retention rate and advance recovery rate are one
 * join away.
 *
 * The form therefore shows the arithmetic on screen — basis, rate, and the product — so
 * the number is authored visibly by a person rather than silently by us.
 */
export interface AddIpaDeductionPayload {
  deductionType: string;
  sourceTermId?: string;
  rate?: string;
  basis: string;
  amount: string;
}

/** `GET /ipa`, optionally scoped to one contract. Newest first. */
export function listIpas(contractId?: string): Promise<Ipa[]> {
  return apiClient<Ipa[]>('/ipa', {
    ...(contractId ? { params: { contractId } } : {}),
  });
}

/** `GET /ipa?projectId=` — all applications across every contract on a project. */
export function listIpasByProject(projectId: string): Promise<Ipa[]> {
  return apiClient<Ipa[]>('/ipa', { params: { projectId } });
}

/** Returns the application with items, deductions and the three computed totals. */
export function getIpa(id: string): Promise<IpaDetail> {
  return apiClient<IpaDetail>(`/ipa/${id}`);
}

export function createIpa(payload: CreateIpaPayload): Promise<Ipa> {
  return apiClient<Ipa>('/ipa', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Runs a lifecycle command.
 *
 * A `422` here means a `WorkflowRequirementPolicy` is REQUIRED for this transition but no
 * binding is configured — the shared lifecycle hook maps that to the
 * "contact your administrator" message rather than a retry prompt.
 */
export function runIpaCommand(id: string, command: IpaCommand): Promise<Ipa> {
  return apiClient<Ipa>(`/ipa/${id}/${command}`, { method: 'POST' });
}

export function cancelIpa(id: string): Promise<Ipa> {
  return apiClient<Ipa>(`/ipa/${id}/cancel`, { method: 'POST' });
}

export function addIpaItem(ipaId: string, payload: AddIpaItemPayload): Promise<IpaItem> {
  return apiClient<IpaItem>(`/ipa/${ipaId}/items`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function removeIpaItem(ipaId: string, itemId: string): Promise<void> {
  return apiClient<void>(`/ipa/${ipaId}/items/${itemId}`, { method: 'DELETE' });
}

export function addIpaDeduction(
  ipaId: string,
  payload: AddIpaDeductionPayload,
): Promise<IpaDeduction> {
  return apiClient<IpaDeduction>(`/ipa/${ipaId}/deductions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function removeIpaDeduction(ipaId: string, deductionId: string): Promise<void> {
  return apiClient<void>(`/ipa/${ipaId}/deductions/${deductionId}`, { method: 'DELETE' });
}
