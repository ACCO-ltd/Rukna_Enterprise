import { BillingModel, ContractStatus } from '@erp/types';

/**
 * Contract wire shapes live in `src/lib/api-types.ts` with every other shape the API
 * returns — one place to check a backend contract, one place to delete when `@erp/types`
 * ships DTOs (B12).
 */
export type {
  Contract,
  ContractDetail,
  ContractAdvanceTerm,
  ContractGuarantee,
  ContractMilestone,
  ContractRetentionTerms,
} from '@/lib/api-types';

export { BillingModel, ContractStatus };

/**
 * Lifecycle order for status groupings and filters.
 *
 * `FINAL_ACCOUNT_PENDING` has no command that reaches it from the contract itself — a
 * contract lands there when its project records practical completion, which moves every
 * ACTIVE contract on that project at once (`project.service.ts`). It appears here because
 * contracts do sit in that state and must be filterable.
 *
 * `TERMINATED` sits alongside `CANCELLED` as a second abnormal ending: cancelled means the
 * contract never took effect, terminated means it did and was stopped.
 */
export const CONTRACT_STATUS_ORDER: ContractStatus[] = [
  ContractStatus.DRAFT,
  ContractStatus.UNDER_REVIEW,
  ContractStatus.PENDING_SIGNATURE,
  ContractStatus.ACTIVE,
  ContractStatus.FINAL_ACCOUNT_PENDING,
  ContractStatus.CLOSED,
  ContractStatus.CANCELLED,
  ContractStatus.TERMINATED,
];

/** Billing models offered when creating a contract, in the API's own order. */
export const BILLING_MODELS: BillingModel[] = [
  BillingModel.MEASURED_IPC,
  BillingModel.MILESTONE,
  BillingModel.TIME_AND_MATERIAL,
  BillingModel.HYBRID,
];
