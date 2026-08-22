import { apiClient } from '@/lib/api-client';

import type { Ipc, IpcDetail, IssueIpcPayload } from '../types';

/**
 * `GET /ipc`, optionally scoped to one application.
 *
 * `applicationId` is the ONLY filter. There is no way to ask for the certificates of a
 * client, a contract or a project, and a certificate row carries nothing but its
 * `applicationId` to identify what it belongs to — so relating certificates to a client
 * means walking certificate → application → contract → client with three unfiltered list
 * calls and a client-side join. See C16 and `certificatesForClient`.
 */
export function listIpcs(applicationId?: string): Promise<Ipc[]> {
  return apiClient<Ipc[]>('/ipc', {
    ...(applicationId ? { params: { applicationId } } : {}),
  });
}

/** `GET /ipc?projectId=` - certificates across the project's applications. */
export function listIpcsByProject(projectId: string): Promise<Ipc[]> {
  return apiClient<Ipc[]>('/ipc', { params: { projectId } });
}

/** Returns the certificate with items, deductions and the derived `netCertified`. */
export function getIpc(id: string): Promise<IpcDetail> {
  return apiClient<IpcDetail>(`/ipc/${id}`);
}

/**
 * Issues a new payment certificate.
 *
 * - `certifiedTotal` is server-computed — do not include it.
 * - RETENTION and ADVANCE_RECOVERY deductions are auto-generated — do not include them
 *   in the `deductions` array.
 * - `varianceReason` is required by the server whenever `certifiedQuantity` ≠
 *   `cumulativeClaimed` for that item.
 * - For `REJECTED` certificates: pass `items: []` and `deductions: []`.
 */
export function issueIpc(payload: IssueIpcPayload): Promise<Ipc> {
  return apiClient<Ipc>('/ipc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface SupersedeIpcPayload {
  newCertificateId: string;
  reason: string;
}

/**
 * Atomically supersedes the current effective certificate for an application.
 *
 * The effective cert gets `isEffective = false` + `supersededAt` + `supersessionReason`.
 * The new certificate (`newCertificateId`) gets `isEffective = true` + `effectiveAt`.
 */
export function supersedeIpc(applicationId: string, payload: SupersedeIpcPayload): Promise<void> {
  return apiClient<void>(`/ipc/${applicationId}/supersede`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * `GET /customer-receipts/certificate/:id/payment-status` is deliberately NOT wrapped here.
 *
 * ADR-024 made it invoice-based (measured against the VAT-inclusive ClientInvoice raised off
 * the IPC), so it is now correct — but this screen already holds the invoice figures and derives
 * settlement locally from them, so the round-trip is unnecessary. The endpoint remains available
 * for callers that only have a certificate id.
 */
