import { WorkflowTransactionType } from '@erp/types';

/** Eng Ahmed-approved first-release ACCO policy surface. Anything absent remains non-routable. */
const approvedTransitions: Partial<Record<WorkflowTransactionType, readonly string[]>> = {
  MATERIAL_REQUEST: ['DRAFT:SUBMITTED'],
  PURCHASE_ORDER: ['DRAFT:SUBMITTED'],
  SUPPLIER_PAYMENT: ['DRAFT:SUBMITTED'],
  BOQ_BASELINE: ['DRAFT:BASELINED'],
};

export function isSupportedPolicyTransition(type: WorkflowTransactionType, from?: string, to?: string) {
  if (!from || !to) return false;
  return approvedTransitions[type]?.includes(`${from}:${to}`) ?? false;
}

export function transitionOptions(type: WorkflowTransactionType) { return approvedTransitions[type] ?? []; }
export function isApprovedPolicyTransaction(type: WorkflowTransactionType) { return Boolean(approvedTransitions[type]); }
