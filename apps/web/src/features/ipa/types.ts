import { IpaStatus } from '@erp/types';

/**
 * IPA wire shapes live in `src/lib/api-types.ts` with every other shape the API returns.
 */
export type { Ipa, IpaDetail, IpaItem, IpaDeduction } from '@/lib/api-types';

export { IpaStatus };

/**
 * Lifecycle order for status groupings.
 *
 * `RETURNED_FOR_REVISION` sits after `PENDING_INTERNAL_APPROVAL` because that is where it
 * comes from, but it is a step BACKWARDS — the application returns to being editable.
 * It is the only status in the platform reached by moving against the flow.
 */
export const IPA_STATUS_ORDER: IpaStatus[] = [
  IpaStatus.DRAFT,
  IpaStatus.PENDING_INTERNAL_APPROVAL,
  IpaStatus.RETURNED_FOR_REVISION,
  IpaStatus.APPROVED_FOR_SUBMISSION,
  IpaStatus.SUBMITTED,
  IpaStatus.CANCELLED,
];
