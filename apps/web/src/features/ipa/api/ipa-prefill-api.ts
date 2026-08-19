import type { IpaPrefillResponse } from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * IPA pre-fill (ADR-021/023). Suggests claim quantities from VERIFIED physical progress.
 *
 * Firewall-safe: it SUGGESTS only. The QS reviews and confirms, then the IPA is created the
 * normal way (`POST /ipa` + `POST /ipa/:id/items`). Nothing here auto-bills. Each line's
 * `suggestedCumulativeClaim` is clamped to [previouslyCertified, BOQ measurable].
 */
export function getIpaPrefill(contractId: string): Promise<IpaPrefillResponse> {
  return apiClient<IpaPrefillResponse>('/ipa/prefill', { params: { contractId } });
}
