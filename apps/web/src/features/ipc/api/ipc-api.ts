import { apiClient } from '@/lib/api-client';

import type { CertificatePaymentStatus, Ipc, IpcDetail, IssueIpcPayload } from '../types';

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
export function supersedeIpc(
  applicationId: string,
  payload: SupersedeIpcPayload,
): Promise<void> {
  return apiClient<void>(`/ipc/${applicationId}/supersede`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Settlement status for one certificate.
 *
 * Returns `{ totalAllocated, netCertified, status }`, all decimal strings.
 *
 * Both defects this endpoint used to carry are fixed, verified against
 * `finance.repository.ts` on 2026-08-09:
 *
 *  - C7 (#11) — `status` compared allocations against the GROSS `certifiedTotal`, so any
 *    certificate carrying a deduction was pinned at PARTIALLY_PAID. It compares against
 *    `netCertified` now.
 *  - C8 — `totalAllocated` was a JS number rather than a decimal string. It is `.toFixed(2)`
 *    now, like every other money field.
 *
 * `settlementFor` still derives the state locally rather than reading `status`: the server
 * has no `OVER_ALLOCATED`, and the net it measures against must be the one this screen
 * displays. See the note on that function.
 */
export function getCertificatePaymentStatus(
  certificateId: string,
): Promise<CertificatePaymentStatus> {
  return apiClient<CertificatePaymentStatus>(
    `/receipts/certificate/${certificateId}/payment-status`,
  );
}
