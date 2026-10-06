/**
 * The Dashboard read model (`GET /dashboard`) — decisions P30–P32 of the design system.
 *
 * One response, scoped to the caller: what needs them (To do), where the money stands (figures,
 * receivables by age), how each project is doing, and — for a new company — the setup checklist.
 * Every figure, row and permission decision is the server's; the client only presents it.
 *
 * Money is a decimal string, or null when the caller may not see it (`moneyVisible: false`):
 * hidden money is never zero. Rows carry codes and facts, never display sentences; the web maps
 * `kind` + facts to words.
 */

import type { ProjectActivityEventResponse } from './construction';

/** P32 — which first screen the company gets. Decided on the whole organisation, not the caller. */
export type DashboardStage =
  /** No project yet: the setup checklist replaces everything else. */
  | 'NEW'
  /** Every open project is still in Preparation (DRAFT): readiness per project. */
  | 'PREPARATION'
  /** At least one project has started: the portfolio view. */
  | 'RUNNING';

/** Tone is a semantic of the row, always repeated in its words — never colour alone. */
export type DashboardTone = 'danger' | 'attention' | 'neutral';

interface DashboardTodoBase {
  /** Stable React key, unique within the list. */
  key: string;
  tone: DashboardTone;
  /** The app route where the work is done. */
  href: string;
  /** Decimal string; null when the row has no amount or money is hidden from the caller. */
  amount: string | null;
  currency: string | null;
}

/** A posted client invoice past its due date (the commercial D5 overdue rule). */
export interface DashboardTodoInvoiceOverdue extends DashboardTodoBase {
  kind: 'INVOICE_OVERDUE';
  invoiceNumber: string;
  clientName: string | null;
  projectName: string | null;
  dueDate: string;
  daysLate: number;
}

/** A payment stage `installmentBillingBlocker(at: 'raise')` clears, not yet invoiced. */
export interface DashboardTodoStageReadyToBill extends DashboardTodoBase {
  kind: 'STAGE_READY_TO_BILL';
  projectName: string;
  /** 1-based stage number in the payment schedule. */
  stageNumber: number;
  stageLabel: string | null;
  /** The linked milestone, when there is one. */
  milestoneLabel: string | null;
  verifiedAt: string | null;
  /** A draft invoice already exists for the stage; it needs issuing, not preparing. */
  draftPrepared: boolean;
}

/** A supplier bill whose PO match raised an exception. */
export interface DashboardTodoBillMatchException extends DashboardTodoBase {
  kind: 'BILL_MATCH_EXCEPTION';
  billNumber: string | null;
  supplierName: string | null;
}

/** Supplier bills waiting for approval that the caller may approve (not their own). */
export interface DashboardTodoBillsAwaitingApproval extends DashboardTodoBase {
  kind: 'BILLS_AWAITING_APPROVAL';
  count: number;
  oldestBillNumber: string | null;
  oldestSupplierName: string | null;
  oldestSubmittedAt: string | null;
}

/** A submitted material request the caller may approve (not their own). */
export interface DashboardTodoMaterialRequestAwaitingApproval extends DashboardTodoBase {
  kind: 'MATERIAL_REQUEST_AWAITING_APPROVAL';
  mrNumber: string;
  title: string | null;
  projectName: string | null;
  requiredByDate: string | null;
}

/** Submitted daily reports on one project, waiting for a reviewer the caller is. */
export interface DashboardTodoReportsToReview extends DashboardTodoBase {
  kind: 'REPORTS_TO_REVIEW';
  projectName: string;
  count: number;
  oldestReportDate: string;
}

/** A programme milestone whose linked work is complete — `readyToVerify` on the milestone list. */
export interface DashboardTodoMilestoneReadyToVerify extends DashboardTodoBase {
  kind: 'MILESTONE_READY_TO_VERIFY';
  projectName: string;
  milestoneLabel: string;
}

/** The accounting setup cycle of `GET /accounting/guide` is not finished. */
export interface DashboardTodoAccountingSetup extends DashboardTodoBase {
  kind: 'ACCOUNTING_SETUP_INCOMPLETE';
  stepsLeft: number;
}

/** A Preparation project whose every Start condition is met. */
export interface DashboardTodoProjectReadyToStart extends DashboardTodoBase {
  kind: 'PROJECT_READY_TO_START';
  projectName: string;
}

/** Preparation projects with no executed client contract yet. */
export interface DashboardTodoProjectsWithoutContract extends DashboardTodoBase {
  kind: 'PROJECTS_WITHOUT_CONTRACT';
  count: number;
}

export type DashboardTodoItem =
  | DashboardTodoInvoiceOverdue
  | DashboardTodoStageReadyToBill
  | DashboardTodoBillMatchException
  | DashboardTodoBillsAwaitingApproval
  | DashboardTodoMaterialRequestAwaitingApproval
  | DashboardTodoReportsToReview
  | DashboardTodoMilestoneReadyToVerify
  | DashboardTodoAccountingSetup
  | DashboardTodoProjectReadyToStart
  | DashboardTodoProjectsWithoutContract;

export type DashboardTodoKind = DashboardTodoItem['kind'];

/** Receivables by age — outstanding on posted client invoices, by whole UTC days past due. */
export interface DashboardReceivablesAging {
  notDue: string;
  days1To30: string;
  days31To60: string;
  over60: string;
}

/**
 * The headline money, one entry per currency (money is never added across currencies). Only for
 * callers who see money, over the projects they may see.
 */
export interface DashboardFigures {
  currency: string;
  /** Σ executed contract value of ACTIVE projects (the recorded contract, never the estimate). */
  contractValueInProgress: string;
  activeProjectCount: number;
  receivables: {
    outstanding: string;
    unpaidInvoiceCount: number;
    overdue: string;
    overdueInvoiceCount: number;
    /** Days the most-late overdue invoice is past due; null when nothing is overdue. */
    oldestDaysLate: number | null;
    aging: DashboardReceivablesAging;
  };
  payables: {
    /** Σ outstanding of posted supplier bills. */
    outstanding: string;
    unpaidBillCount: number;
    /** Σ outstanding of those due within the next 7 days, overdue ones included. */
    dueThisWeek: string;
  };
}

/** A started project (Active, Practical completion, Closeout) in the portfolio table. */
export interface DashboardProjectInProgress {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  status: string;
  /** Weighted verified physical % (`progress/rollup`); null before any work package exists. */
  physicalPercent: number | null;
  /** Planned % today from the governing curve (`programme/schedule-variance`); null with no plan. */
  plannedPercent: number | null;
  currency: string | null;
  /** Executed contract value; null when hidden or no contract. */
  contractValue: string | null;
  outstanding: string | null;
  overdue: string | null;
}

/** The project's value: the executed contract's, else the estimate entered at creation. */
export interface DashboardProjectValue {
  amount: string;
  currency: string | null;
  /** `CONTRACT` = executed main contract; `ESTIMATE` = `Project.contractValue` typed at creation. */
  source: 'CONTRACT' | 'ESTIMATE';
}

/** A Preparation project — what it still needs before it can start (the Overview checklist). */
export interface DashboardProjectInPreparation {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  readiness: { done: number; total: number };
  /** The first open Start condition in checklist order; null when ready to start. */
  nextStep: {
    code: string;
    owner: PreparationStepOwner;
  } | null;
  /** Null when hidden from the caller or nothing is recorded. */
  value: DashboardProjectValue | null;
}

export type PreparationStepOwner = 'projectManager' | 'commercialTeam' | 'quantitySurveyor';

/**
 * The Start conditions in the order the project Overview checklist reads them, and who owns each.
 * Shared by the API (dashboard `nextStep`) and the web (the Overview checklist) so the two agree.
 * Codes the server adds later and this list does not know sort after these.
 */
export const PREPARATION_STEP_ORDER = [
  'CLIENT_ACTIVE',
  'BOQ_BASELINED',
  'ACTIVE_MAIN_CONTRACT',
  'CONTRACT_START_DATE',
  'DELIVERY_TEAM',
  'PROGRAMME_DATES',
] as const;

export type PreparationStepCode = (typeof PREPARATION_STEP_ORDER)[number];

export const PREPARATION_STEP_OWNER: Record<PreparationStepCode, PreparationStepOwner> = {
  CLIENT_ACTIVE: 'projectManager',
  BOQ_BASELINED: 'quantitySurveyor',
  ACTIVE_MAIN_CONTRACT: 'commercialTeam',
  CONTRACT_START_DATE: 'commercialTeam',
  DELIVERY_TEAM: 'projectManager',
  PROGRAMME_DATES: 'projectManager',
};

/** "Get {company} ready" — the new-company checklist (stage NEW). */
export type DashboardSetupStepCode = 'CLIENT' | 'PROJECT' | 'ACCOUNTING' | 'SUPPLIERS' | 'TEAM';

export interface DashboardSetupStep {
  code: DashboardSetupStepCode;
  done: boolean;
  optional: boolean;
  /** The caller holds the permission to do this step; the web shows its action only then. */
  canAct: boolean;
}

export interface DashboardActivityEvent extends ProjectActivityEventResponse {
  project: { id: string; name: string };
}

export interface DashboardResponse {
  organizationName: string;
  stage: DashboardStage;
  /** The caller may see money: figures, amounts, money columns and the receivables rail. */
  moneyVisible: boolean;
  /** `ALL` = the caller sees every project; `MINE` = only projects they are a member of. */
  projectScope: 'ALL' | 'MINE';
  /** In urgency order: danger, then attention, then neutral. */
  todo: DashboardTodoItem[];
  /** Null when money is hidden; empty when there is nothing to count yet. */
  figures: DashboardFigures[] | null;
  projects: {
    inProgress: DashboardProjectInProgress[];
    inPreparation: DashboardProjectInPreparation[];
    /** Every visible project by `ProjectStatus` — the quiet counts line under the table title. */
    statusCounts: Record<string, number>;
  };
  /** Newest first, at most 5, from projects the caller may see; never carries an amount. */
  activity: DashboardActivityEvent[];
  /** Only for stage NEW; null otherwise. */
  setup: DashboardSetupStep[] | null;
  asOf: string;
}
