import { WorkflowTransactionType } from '@erp/types';

/** Eng Ahmed-approved first-release ACCO policy surface. Anything absent remains non-routable. */
const approvedTransitions: Partial<Record<WorkflowTransactionType, readonly string[]>> = {
  MATERIAL_REQUEST: ['DRAFT:SUBMITTED'],
  PURCHASE_ORDER: ['DRAFT:SUBMITTED'],
  SUPPLIER_PAYMENT: ['DRAFT:SUBMITTED'],
  // ADR-029 §8 A-3 / CONST-BOQ-034 — commit-to-contract (`DRAFT:COMMITTED`) is the governed
  // successor of baseline; it reuses the BOQ_BASELINE transaction type (no new enum → no
  // migration). `DRAFT:BASELINED` is kept so any legacy in-flight approval stays routable.
  BOQ_BASELINE: ['DRAFT:COMMITTED', 'DRAFT:BASELINED'],
};

export function isSupportedPolicyTransition(type: WorkflowTransactionType, from?: string, to?: string) {
  if (!from || !to) return false;
  return approvedTransitions[type]?.includes(`${from}:${to}`) ?? false;
}

export function transitionOptions(type: WorkflowTransactionType) { return approvedTransitions[type] ?? []; }
export function isApprovedPolicyTransaction(type: WorkflowTransactionType) { return Boolean(approvedTransitions[type]); }
