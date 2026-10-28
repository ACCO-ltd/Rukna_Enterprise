import type { ApprovalItem } from '@erp/types';

/** Governed documents whose own page the inbox can open by id alone. */
const WORKFLOW_ROUTES: Record<string, (id: string) => string> = {
  PURCHASE_ORDER: (id) => `/procurement/orders/${id}`,
  MATERIAL_REQUEST: (id) => `/procurement/requests/${id}`,
  QUOTATION_AWARD: (id) => `/finance/quotes/${id}`,
  SUPPLIER_PAYMENT: (id) => `/finance/accounting/payments/${id}`,
  SUPPLIER_BILL: (id) => `/finance/accounting/bills/${id}`,
  MANUAL_JOURNAL: (id) => `/finance/accounting/journals/${id}`,
  CLIENT_INVOICE: (id) => `/finance/accounting/invoices/${id}`,
};

/**
 * Where an inbox item is decided: the document's own page, which holds the Approve / Decide
 * action. Null when the document's page needs more than its id (a project-scoped variation).
 */
export function approvalHref(item: ApprovalItem): string | null {
  switch (item.kind) {
    case 'JOURNAL':
      return `/finance/accounting/journals/${item.id}`;
    case 'BILL':
      return `/finance/accounting/bills/${item.id}`;
    case 'PAYMENT':
      return `/finance/accounting/payments/${item.id}`;
    case 'QUOTATION':
      return `/finance/quotes/${item.id}`;
    case 'MATERIAL_REQUEST':
      return `/procurement/requests/${item.id}`;
    case 'PROGRESS_REPORT':
      return item.projectId ? `/projects/${item.projectId}/progress/review` : null;
    case 'WORKFLOW':
      return item.transactionType ? (WORKFLOW_ROUTES[item.transactionType]?.(item.id) ?? null) : null;
  }
}

/** Whole days an item has waited, for "waiting 3 days". */
export function daysWaiting(waitingSince: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(waitingSince).getTime()) / 86_400_000));
}
