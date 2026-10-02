import {
  PERMISSIONS,
  type ClientCommand,
  type ClientDeactivationBlocker,
  type ClientInvoiceCollectionStatus,
} from '@erp/types';

/**
 * Clients redesign — the pure rules behind the record (docs/design/clients-redesign-contract.md).
 *
 * ARCH-BOUNDARY: the clients module is platform and must not import construction or accounting
 * services. The few commercial rules it needs are restated here and point at their canonical home;
 * keep them in step.
 */

const DAY_MS = 86_400_000;

/** Midnight UTC for a moment — so "days late" counts calendar days, not elapsed hours. */
export function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Whole UTC calendar days from the due date to `asOf`; negative while not yet due, 0 on the due
 * date. Canonical: `daysPastDue` in business/construction/commercial/domain/commercial-workspace.policy.ts
 * (commercial redesign D5 "one overdue rule").
 */
export function daysPastDue(dueDate: Date, asOf: Date): number {
  return Math.round((utcMidnight(asOf) - utcMidnight(dueDate)) / DAY_MS);
}

/**
 * Days before the due date (inclusive) within which an invoice counts as DUE_SOON. Canonical:
 * `INSTALLMENT_DUE_SOON_DAYS` in platform/notifications/domain/installment-due-attention.policy.ts.
 */
export const DUE_SOON_DAYS = 7;

/** OVERDUE past the due date; DUE_SOON within 7 days of it; otherwise (or with no due date) CURRENT. */
export function collectionStatus(dueDate: Date | null, asOf: Date): ClientInvoiceCollectionStatus {
  if (!dueDate) return 'CURRENT';
  const late = daysPastDue(dueDate, asOf);
  if (late > 0) return 'OVERDUE';
  if (-late <= DUE_SOON_DAYS) return 'DUE_SOON';
  return 'CURRENT';
}

/** Projects counted as "active" on the list and overview (live work). */
export const ACTIVE_PROJECT_STATUSES = ['ACTIVE', 'PRACTICAL_COMPLETION', 'CLOSEOUT'] as const;

/**
 * Projects that block deactivation: anything not finished — every status except CLOSED and
 * CANCELLED (a DRAFT project still names the client and will need it).
 */
export const FINISHED_PROJECT_STATUSES = ['CLOSED', 'CANCELLED'] as const;

/** Contracts whose value counts as "active contract value": signed and still running. */
export const LIVE_CONTRACT_STATUSES = ['ACTIVE', 'FINAL_ACCOUNT_PENDING'] as const;

/** Contracts whose value is the project's contract value on the overview: signed, any stage. */
export const SIGNED_CONTRACT_STATUSES = ['ACTIVE', 'FINAL_ACCOUNT_PENDING', 'CLOSED'] as const;

export interface DeactivationFacts {
  unfinishedProjectCount: number;
  /** Σ outstanding of POSTED invoices > 0. */
  hasOpenBalance: boolean;
}

/** Projects first (the bigger obligation), then money owed. */
export function deactivationBlocker(facts: DeactivationFacts): ClientDeactivationBlocker | null {
  if (facts.unfinishedProjectCount > 0) return 'ACTIVE_PROJECTS';
  if (facts.hasOpenBalance) return 'OPEN_BALANCE';
  return null;
}

export function allowedClientCommands(
  status: 'ACTIVE' | 'INACTIVE',
  permissions: readonly string[],
  blocker: ClientDeactivationBlocker | null,
): ClientCommand[] {
  if (!permissions.includes(PERMISSIONS.clientsManage)) return [];
  if (status === 'INACTIVE') return ['REACTIVATE'];
  return blocker === null ? ['DEACTIVATE'] : [];
}

// ─── Activity ────────────────────────────────────────────────────────────────

/** `sourceCommand` values written to the audit log (`resource: 'client'`). */
export const CLIENT_AUDIT = {
  create: { action: 'CREATE', sourceCommand: 'client.create', eventType: 'CLIENT_CREATED' },
  update: { action: 'UPDATE', sourceCommand: 'client.update', eventType: 'CLIENT_UPDATED' },
  contactAdd: { action: 'CREATE', sourceCommand: 'client.contact.add', eventType: 'CLIENT_CONTACT_ADDED' },
  contactUpdate: { action: 'UPDATE', sourceCommand: 'client.contact.update', eventType: 'CLIENT_CONTACT_UPDATED' },
  contactMakePrimary: {
    action: 'UPDATE',
    sourceCommand: 'client.contact.make-primary',
    eventType: 'CLIENT_PRIMARY_CONTACT_CHANGED',
  },
  contactRemove: { action: 'DELETE', sourceCommand: 'client.contact.remove', eventType: 'CLIENT_CONTACT_REMOVED' },
  deactivate: { action: 'UPDATE', sourceCommand: 'client.deactivate', eventType: 'CLIENT_DEACTIVATED' },
  reactivate: { action: 'UPDATE', sourceCommand: 'client.reactivate', eventType: 'CLIENT_REACTIVATED' },
} as const;

export const CLIENT_AUDIT_RESOURCE = 'client';

const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  type: 'type',
  taxNumber: 'tax ID',
  registrationNumber: 'registration number',
  paymentTermsDays: 'payment terms',
  defaultCurrency: 'currency',
  countryCode: 'country',
  city: 'city',
  address: 'address',
  invoiceEmail: 'invoice email',
  notes: 'notes',
  role: 'role',
  phone: 'phone',
  whatsappPhone: 'WhatsApp number',
  email: 'email',
};

function changedFields(after: Record<string, unknown> | null): string {
  const keys = Object.keys(after ?? {}).filter((k) => k !== 'contactName' && k !== 'contactId');
  const labels = keys.map((k) => FIELD_LABEL[k] ?? k);
  return labels.length ? labels.join(', ') : 'details';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * One sentence for an audit row. Client audit rows never carry an amount (client master data has
 * none), so these are safe for every reader.
 */
export function clientAuditSummary(
  sourceCommand: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  reason: string | null,
): string {
  switch (sourceCommand) {
    case 'client.create':
      return `Created client ${str(after?.['name'])}`.trim();
    case 'client.update':
      return `Updated ${changedFields(after)}`;
    case 'client.contact.add':
      return `Added contact ${str(after?.['name'])}`.trim();
    case 'client.contact.update':
      return `Updated contact ${str(after?.['contactName'] ?? before?.['contactName'])} (${changedFields(after)})`;
    case 'client.contact.make-primary':
      return `Made ${str(after?.['contactName'])} the primary contact`;
    case 'client.contact.remove':
      return `Removed contact ${str(before?.['name'])}`.trim();
    case 'client.deactivate':
      return reason ? `Deactivated — ${reason}` : 'Deactivated';
    case 'client.reactivate':
      return 'Reactivated';
    default:
      return 'Updated';
  }
}
