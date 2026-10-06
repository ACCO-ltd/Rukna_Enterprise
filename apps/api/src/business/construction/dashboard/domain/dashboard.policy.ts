import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  PREPARATION_STEP_ORDER,
  PREPARATION_STEP_OWNER,
  type DashboardFigures,
  type DashboardProjectInPreparation,
  type DashboardReceivablesAging,
  type DashboardSetupStep,
  type DashboardStage,
  type DashboardTodoItem,
  type DashboardTodoKind,
  type DashboardTone,
  type PreparationStepCode,
} from '@erp/types';

import { daysPastDue } from '../../commercial/domain/commercial-workspace.policy.js';
import { agingBucket, type AgingBucket } from '../../commercial/domain/receivable-aging.js';
import { computeReceivablePosition } from '../../commercial/domain/receivable-position.js';

/**
 * Pure assembly rules for the Dashboard (`GET /dashboard`, design-system decisions P30–P32). Every
 * figure arrives computed by a shared formula — `computeReceivablePosition` (receivables),
 * `agingBucket` + `daysPastDue` (aging, overdue), `evaluateReadiness` (Preparation) — this file
 * only decides the stage, folds and orders, and never introduces a second formula.
 */

const ZERO = new Decimal(0);

// ── Stage (P32) ──────────────────────────────────────────────────────────────────

/** Statuses of a project that has started (or finished) — any one makes the company RUNNING. */
const STARTED_STATUSES = new Set(['ACTIVE', 'PRACTICAL_COMPLETION', 'CLOSEOUT', 'CLOSED']);

/**
 * Decided on the whole organisation, never the caller: NEW while it has no project other than a
 * cancelled one; PREPARATION while ≥ 1 project is in DRAFT and none has ever started; else RUNNING.
 */
export function decideStage(orgStatusCounts: Readonly<Record<string, number>>): DashboardStage {
  const count = (status: string) => orgStatusCounts[status] ?? 0;
  const live = Object.entries(orgStatusCounts)
    .filter(([status]) => status !== 'CANCELLED')
    .reduce((sum, [, n]) => sum + n, 0);
  if (live === 0) return 'NEW';
  const started = [...STARTED_STATUSES].some((status) => count(status) > 0);
  if (!started && count('DRAFT') > 0) return 'PREPARATION';
  return 'RUNNING';
}

/** Project statuses shown in the portfolio's "in progress" table. */
export const IN_PROGRESS_STATUSES = ['ACTIVE', 'PRACTICAL_COMPLETION', 'CLOSEOUT'] as const;

// ── Preparation (readiness → next step) ─────────────────────────────────────────

/**
 * Done / total over the Start conditions, and the first open one in the Overview checklist's order
 * (`PREPARATION_STEP_ORDER`; a code that list does not know sorts after, in server order). Null
 * when every condition is satisfied. An unknown code has no owner mapping; it is attributed to the
 * project manager, who owns the project's Preparation as a whole.
 */
export function preparationProgress(
  conditions: ReadonlyArray<{ code: string; satisfied: boolean }>,
): Pick<DashboardProjectInPreparation, 'readiness' | 'nextStep'> {
  const done = conditions.filter((c) => c.satisfied).length;
  const rank = (code: string) => {
    const i = (PREPARATION_STEP_ORDER as readonly string[]).indexOf(code);
    return i === -1 ? PREPARATION_STEP_ORDER.length : i;
  };
  const open = conditions
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => !c.satisfied)
    .sort((a, b) => rank(a.c.code) - rank(b.c.code) || a.index - b.index)[0];
  return {
    readiness: { done, total: conditions.length },
    nextStep: open
      ? {
          code: open.c.code,
          owner: PREPARATION_STEP_OWNER[open.c.code as PreparationStepCode] ?? 'projectManager',
        }
      : null,
  };
}

// ── Figures ─────────────────────────────────────────────────────────────────────

/** The dashboard's four aging columns: the commercial buckets, with 61–90 and 90+ folded together. */
export function dashboardAgingKey(bucket: AgingBucket): keyof DashboardReceivablesAging {
  switch (bucket) {
    case 'NOT_DUE':
      return 'notDue';
    case 'DAYS_1_30':
      return 'days1To30';
    case 'DAYS_31_60':
      return 'days31To60';
    case 'DAYS_61_90':
    case 'DAYS_90_PLUS':
      return 'over60';
  }
}

export interface FigureInputs {
  today: Date;
  /**
   * ACTIVE projects the caller sees: the recorded main contract's value and currency, or — for a
   * project with no contract — `contractValue: null` and the project's own currency.
   */
  activeProjects: ReadonlyArray<{ currency: string | null; contractValue: Decimal | null }>;
  /** POSTED client invoices with a balance. */
  openInvoices: ReadonlyArray<{
    currencyCode: string;
    totalAmount: Decimal;
    outstandingAmount: Decimal;
    dueDate: Date | null;
  }>;
  /** POSTED supplier bills with a balance. */
  openBills: ReadonlyArray<{ currencyCode: string; outstandingAmount: Decimal; dueDate: Date }>;
}

/** "Due this week": due within the next 7 whole UTC days, overdue ones included. */
const DUE_SOON_DAYS = 7;

/**
 * The headline money, one entry per currency (never added across currencies), in currency-code
 * order. Receivables use `computeReceivablePosition` — the Commercial Overview's formula — over the
 * open invoices of each currency; aging buckets each invoice by `agingBucket(daysPastDue)`.
 *
 * "Never zeros": a currency gets an entry only when something is active (an ACTIVE project) or
 * invoiced (an unpaid posted invoice) in it. Payables in a currency with neither are omitted —
 * there is no strip to carry them. Empty when nothing qualifies (the web hides the strip).
 */
export function buildFigures(input: FigureInputs): DashboardFigures[] {
  const { today, activeProjects, openInvoices, openBills } = input;

  const currencies = new Set<string>();
  for (const p of activeProjects) if (p.currency) currencies.add(p.currency);
  for (const inv of openInvoices) currencies.add(inv.currencyCode);

  return [...currencies].sort().map((currency) => {
    const active = activeProjects.filter((p) => p.currency === currency);
    const contractValue = active.reduce((sum, p) => sum.plus(p.contractValue ?? ZERO), ZERO);
    const invoices = openInvoices.filter((inv) => inv.currencyCode === currency);
    // Only the open-balance side of the position is read: credit notes and receipts are already
    // inside each invoice's `outstandingAmount` (the AR subledger value).
    const position = computeReceivablePosition({
      invoices,
      postedCreditNotesSum: ZERO,
      collectedSum: ZERO,
      today,
    });
    const aging: Record<keyof DashboardReceivablesAging, Decimal> = {
      notDue: ZERO,
      days1To30: ZERO,
      days31To60: ZERO,
      over60: ZERO,
    };
    for (const inv of invoices) {
      const late = inv.dueDate ? daysPastDue(inv.dueDate, today) : 0;
      const key = dashboardAgingKey(agingBucket(late));
      aging[key] = aging[key].plus(inv.outstandingAmount);
    }
    const bills = openBills.filter((bill) => bill.currencyCode === currency);
    const dueThisWeek = bills
      .filter((bill) => daysPastDue(bill.dueDate, today) >= -DUE_SOON_DAYS)
      .reduce((sum, bill) => sum.plus(bill.outstandingAmount), ZERO);

    return {
      currency,
      contractValueInProgress: contractValue.toFixed(2),
      activeProjectCount: active.length,
      receivables: {
        outstanding: position.outstanding.toFixed(2),
        unpaidInvoiceCount: invoices.length,
        overdue: position.overdue.toFixed(2),
        overdueInvoiceCount: position.overdueCount,
        oldestDaysLate: position.oldestDaysPastDue,
        aging: {
          notDue: aging.notDue.toFixed(2),
          days1To30: aging.days1To30.toFixed(2),
          days31To60: aging.days31To60.toFixed(2),
          over60: aging.over60.toFixed(2),
        },
      },
      payables: {
        outstanding: bills.reduce((sum, bill) => sum.plus(bill.outstandingAmount), ZERO).toFixed(2),
        unpaidBillCount: bills.length,
        dueThisWeek: dueThisWeek.toFixed(2),
      },
    };
  });
}

// ── To do ───────────────────────────────────────────────────────────────────────

/** The to-do kinds in display order within a tone (danger → attention → neutral overall). */
export const TODO_KIND_ORDER: ReadonlyArray<DashboardTodoKind> = [
  'INVOICE_OVERDUE',
  'MATERIAL_REQUEST_AWAITING_APPROVAL',
  'BILL_MATCH_EXCEPTION',
  'BILLS_AWAITING_APPROVAL',
  'ACCOUNTING_SETUP_INCOMPLETE',
  'REPORTS_TO_REVIEW',
  'MILESTONE_READY_TO_VERIFY',
  'STAGE_READY_TO_BILL',
  'PROJECT_READY_TO_START',
  'PROJECTS_WITHOUT_CONTRACT',
];

export const TODO_TONE: Readonly<Record<DashboardTodoKind, DashboardTone>> = {
  INVOICE_OVERDUE: 'danger',
  MATERIAL_REQUEST_AWAITING_APPROVAL: 'attention',
  BILL_MATCH_EXCEPTION: 'attention',
  BILLS_AWAITING_APPROVAL: 'attention',
  ACCOUNTING_SETUP_INCOMPLETE: 'attention',
  REPORTS_TO_REVIEW: 'neutral',
  MILESTONE_READY_TO_VERIFY: 'neutral',
  STAGE_READY_TO_BILL: 'neutral',
  PROJECT_READY_TO_START: 'neutral',
  PROJECTS_WITHOUT_CONTRACT: 'neutral',
};

/** Kinds listed one row per record, capped so one busy queue cannot drown the list. */
export const TODO_CAP_PER_KIND = 5;
const CAPPED_KINDS = new Set<DashboardTodoKind>([
  'INVOICE_OVERDUE',
  'MATERIAL_REQUEST_AWAITING_APPROVAL',
  'BILL_MATCH_EXCEPTION',
  'MILESTONE_READY_TO_VERIFY',
  'STAGE_READY_TO_BILL',
]);

const TONE_RANK: Record<DashboardTone, number> = { danger: 0, attention: 1, neutral: 2 };

/**
 * The final list: tone order (danger, attention, neutral), then kind order within a tone, then
 * each kind's own order (already sorted by the caller — most days late, earliest need …), with the
 * capped kinds cut to `TODO_CAP_PER_KIND`.
 */
export function rankTodo(items: ReadonlyArray<DashboardTodoItem>): DashboardTodoItem[] {
  const kindRank = (kind: DashboardTodoKind) => TODO_KIND_ORDER.indexOf(kind);
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        TONE_RANK[a.item.tone] - TONE_RANK[b.item.tone] ||
        kindRank(a.item.kind) - kindRank(b.item.kind) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
  const seen = new Map<DashboardTodoKind, number>();
  return sorted.filter((item) => {
    if (!CAPPED_KINDS.has(item.kind)) return true;
    const n = (seen.get(item.kind) ?? 0) + 1;
    seen.set(item.kind, n);
    return n <= TODO_CAP_PER_KIND;
  });
}

/** Overdue invoices: most days late first; ties by invoice number for a stable list. */
export function byMostLate<T extends { daysLate: number; invoiceNumber: string }>(
  a: T,
  b: T,
): number {
  return b.daysLate - a.daysLate || a.invoiceNumber.localeCompare(b.invoiceNumber);
}

/** Material requests: earliest required-by date first; undated ones last. */
export function byEarliestNeed<T extends { requiredByDate: string | null; mrNumber: string }>(
  a: T,
  b: T,
): number {
  if (a.requiredByDate !== b.requiredByDate) {
    if (a.requiredByDate === null) return 1;
    if (b.requiredByDate === null) return -1;
    return a.requiredByDate.localeCompare(b.requiredByDate);
  }
  return a.mrNumber.localeCompare(b.mrNumber);
}

// ── Setup (stage NEW) ───────────────────────────────────────────────────────────

export interface SetupFacts {
  clientCount: number;
  projectCount: number;
  accountingReady: boolean;
  supplierCount: number;
  materialCount: number;
  activeUserCount: number;
}

/** "Get {company} ready": five steps; suppliers + catalogue is the optional one. */
export function buildSetupSteps(
  facts: SetupFacts,
  permissions: readonly string[],
): DashboardSetupStep[] {
  const can = (permission: string) => permissions.includes(permission);
  return [
    {
      code: 'CLIENT',
      done: facts.clientCount > 0,
      optional: false,
      canAct: can(PERMISSIONS.clientsCreate),
    },
    {
      code: 'PROJECT',
      done: facts.projectCount > 0,
      optional: false,
      canAct: can(PERMISSIONS.projectsCreate),
    },
    {
      code: 'ACCOUNTING',
      done: facts.accountingReady,
      optional: false,
      canAct: can(PERMISSIONS.accountingManage),
    },
    {
      code: 'SUPPLIERS',
      done: facts.supplierCount > 0 && facts.materialCount > 0,
      optional: true,
      // Suppliers are created under manage:payable (SupplierController's class guard).
      canAct: can(PERMISSIONS.payablesManage),
    },
    {
      code: 'TEAM',
      done: facts.activeUserCount > 1,
      optional: false,
      canAct: can(PERMISSIONS.usersManage),
    },
  ];
}

/** Money as the dashboard sends it: a 2-dp decimal string, or null when hidden — never "0.00" for hidden. */
export function moneyOrNull(visible: boolean, amount: Decimal | null | undefined): string | null {
  return visible && amount !== null && amount !== undefined ? amount.toFixed(2) : null;
}
