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

/**
 * Settlement status for one certificate.
 *
 * ⚠ Do not present this as truth. `status` compares allocations against the certificate's
 * GROSS `certifiedTotal` rather than `netCertified`, so any certificate carrying a
 * deduction is pinned at PARTIALLY_PAID and can never report PAID — confirmed against the
 * running API in issue #11 (C7). `totalAllocated` is also a JS number rather than a decimal
 * string, unlike every other money field (C8).
 *
 * The UI derives its own settled/outstanding figures from the allocations and the
 * certificate's `netCertified`, and does not call this until C7 is fixed.
 */
export function getCertificatePaymentStatus(
  certificateId: string,
): Promise<CertificatePaymentStatus> {
  return apiClient<CertificatePaymentStatus>(
    `/receipts/certificate/${certificateId}/payment-status`,
  );
}
