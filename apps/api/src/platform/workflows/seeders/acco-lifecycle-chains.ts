import { WorkflowTransactionType } from '@prisma/client';

import { ACCO_ROLES, type AccoRole } from './acco-value-bands.js';

/**
 * ADR-022 — ACCO's fixed (non-amount-banded) approval chains, expressed as data.
 *
 * These are the named lifecycle/control chains of the authority matrix: they route on the
 * transition alone, not on a value band. Each is seeded as one WorkflowDefinition + one
 * STATE_TRANSITION binding, inactive until a deliberate per-org activation.
 */
export interface ApprovalChain {
  key: string;
  name: string;
  entityType: string;
  fromState: string | null;
  toState: string;
  /** Set when the gated command carries a transaction type (BOQ baseline); omitted otherwise. */
  transactionType?: WorkflowTransactionType;
  steps: AccoRole[];
}

const R = ACCO_ROLES;

export function accoApprovalChains(): ApprovalChain[] {
  return [
    // CONST-DOA-006 — Start Project: PM/Construction Director recommends → CFO confirms budget
    // & funding → Group CEO final approval. (The Board is pulled in per delegated authority.)
    {
      key: 'PROJECT_START',
      name: 'Project Start Approval',
      entityType: 'Project',
      fromState: 'DRAFT',
      toState: 'ACTIVE',
      steps: [R.PROJECT_MANAGER, R.CFO, R.CEO],
    },
    // CONST-DOA-007 — Closeout: PM confirms deliverables/defects → Finance confirms final
    // account, AR/AP, retention → Group CEO final closure approval.
    {
      key: 'PROJECT_CLOSEOUT',
      name: 'Project Closeout Approval',
      entityType: 'Project',
      fromState: 'CLOSEOUT',
      toState: 'CLOSED',
      steps: [R.PROJECT_MANAGER, R.FINANCE_OFFICER, R.CEO],
    },
    // CONST-DOA-009 — BOQ baseline is preparer ≠ sole approver: the Construction Director
    // prepares scope + cost, so baselining routes technical prep → CFO budget/commercial
    // confirmation → CEO authorization. (BoqVersion DRAFT → BASELINED is already gated.)
    {
      key: 'BOQ_BASELINE',
      name: 'BOQ Baseline Approval',
      entityType: 'BoqVersion',
      fromState: 'DRAFT',
      toState: 'BASELINED',
      transactionType: WorkflowTransactionType.BOQ_BASELINE,
      steps: [R.CONSTRUCTION_DIRECTOR, R.CFO, R.CEO],
    },
    // CONST-DOA-008 — DPR: Site Engineer prepares (submits), Project Manager approves. The
    // approval chain is the single PM step; preparation is not an approval.
    {
      key: 'DPR_APPROVAL',
      name: 'Daily Progress Report Approval',
      entityType: 'DailyProgressReport',
      fromState: 'SUBMITTED',
      toState: 'APPROVED',
      steps: [R.PROJECT_MANAGER],
    },
  ];
}
