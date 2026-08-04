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
 * ⚠ **Use `totalAllocated`. Do not use `status`.**
 *
 * `totalAllocated` is the sum of every allocation against this certificate, computed in the
 * database, and it is correct. It arrives as a JS number rather than a decimal string,
 * unlike every other money field on the API (C8, recorded on issue #14) — `settlementFor`
 * converts it to integer minor units once and explains why that is safe.
 *
 * `status` compares that sum against the certificate's GROSS `certifiedTotal` rather than
 * its `netCertified`. A client pays the net, so any certificate carrying a deduction is
 * pinned at PARTIALLY_PAID and can never report PAID — confirmed against the running API in
 * issue #11 (C7). `settlementFor` derives the state from `netCertified` instead, which is
 * right today and stays right when #11 lands.
 *
 * This is a narrower rule than the one that used to be here, which said not to call this
 * endpoint at all. That was written when the intent was to display `status` directly; there
 * is no reason to discard a correct sum over a wrong comparison beside it.
 */
export function getCertificatePaymentStatus(
  certificateId: string,
): Promise<CertificatePaymentStatus> {
  return apiClient<CertificatePaymentStatus>(
    `/receipts/certificate/${certificateId}/payment-status`,
  );
}
