import type { ClientStatus } from './enums.js';

/**
 * Clients redesign (2026-10-02) — the wire contract for the client form, list and record.
 * Source: docs/design/clients-redesign-contract.md. Money follows one gate,
 * `view:financial-position`: without it every money field is `null` (never `'0.00'`).
 */

export type ClientTypeValue = 'COMPANY' | 'GOVERNMENT' | 'NGO' | 'INDIVIDUAL' | 'OTHER';

/** A phone as typed: `{ country: 'SO', number: '61 234 5678' }` or a full `'+25261…'` string. */
export type PhoneInput = string | { country: string; number: string };

/** Free webmail domains — a personal address on a COMPANY/GOVERNMENT/NGO client is a warning, never a block. */
export const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'ymail.com',
  'mail.com',
  'gmx.com',
] as const;

// ─── Requests ────────────────────────────────────────────────────────────────

export interface ClientContactInput {
  name: string;
  role?: string | null;
  phone: PhoneInput;
  whatsappPhone?: PhoneInput | null;
  email?: string | null;
}

export interface CreateClientRequest {
  name: string;
  type?: ClientTypeValue;
  taxNumber?: string | null;
  registrationNumber?: string | null;
  paymentTermsDays?: number | null;
  countryCode?: string;
  city?: string | null;
  address?: string | null;
  invoiceEmail?: string | null;
  notes?: string | null;
  primaryContact: ClientContactInput;
}

/** `PATCH /clients/:id` — all optional; `null` clears an optional field. No `status` (use deactivate/reactivate). */
export type UpdateClientRequest = Partial<Omit<CreateClientRequest, 'primaryContact'>>;

export interface AddClientContactRequest extends ClientContactInput {
  /** `true` demotes the current primary. A client's first contact is always primary. */
  isPrimary?: boolean;
}

export interface UpdateClientContactRequest {
  name?: string;
  role?: string | null;
  phone?: PhoneInput;
  whatsappPhone?: PhoneInput | null;
  email?: string | null;
}

export interface DeactivateClientRequest {
  /** 3–500 characters. */
  reason: string;
}

export type ClientListBalanceFilter = 'OWES' | 'OVERDUE';
export type ClientListSort = 'name' | '-name' | 'outstanding' | '-outstanding';

export interface ClientListQuery {
  search?: string;
  status?: ClientStatus | 'ACTIVE' | 'INACTIVE';
  type?: ClientTypeValue;
  /** Ignored without `view:financial-position`. */
  balance?: ClientListBalanceFilter;
  /** Outstanding sorts are ignored (fall back to `name`) without `view:financial-position`. */
  sort?: ClientListSort;
  page?: number;
  pageSize?: number;
}

// ─── Responses ───────────────────────────────────────────────────────────────

export interface ClientContactView {
  id: string;
  clientId: string;
  name: string;
  role: string | null;
  /** E.164 for contacts written since the redesign; legacy rows keep what was typed. */
  phone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export type ClientCommand = 'DEACTIVATE' | 'REACTIVATE';
export type ClientDeactivationBlocker = 'ACTIVE_PROJECTS' | 'OPEN_BALANCE';

/** `GET /clients/:id` (also returned by create, update, deactivate and reactivate). */
export interface ClientDetailResponse {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  type: ClientTypeValue;
  status: 'ACTIVE' | 'INACTIVE';
  taxNumber: string | null;
  registrationNumber: string | null;
  paymentTermsDays: number | null;
  defaultCurrency: string | null;
  countryCode: string;
  city: string | null;
  address: string | null;
  invoiceEmail: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Primary first, then oldest first. */
  contacts: ClientContactView[];
  /** What the caller may do now (permission + rules). */
  allowedCommands: ClientCommand[];
  /** Why the client cannot be deactivated; null when it can, or when it is already inactive. */
  deactivationBlockedBy: ClientDeactivationBlocker | null;
}

export interface ClientListItemView {
  id: string;
  code: string;
  name: string;
  type: ClientTypeValue;
  status: 'ACTIVE' | 'INACTIVE';
  primaryContact: { name: string; phone: string | null } | null;
  /** Projects in ACTIVE, PRACTICAL_COMPLETION or CLOSEOUT. */
  activeProjectCount: number;
  totalProjectCount: number;
  /** Σ outstanding of POSTED invoices; null without money permission. */
  outstanding: string | null;
  /** Σ outstanding of POSTED invoices due before today; null without money permission. */
  overdue: string | null;
}

export interface ClientListResponse {
  items: ClientListItemView[];
  total: number;
  page: number;
  pageSize: number;
  moneyVisible: boolean;
}

export interface ClientOverviewMetrics {
  activeProjectCount: number;
  totalProjectCount: number;
  activeContractValue: string;
  outstanding: string;
  unpaidInvoiceCount: number;
  overdue: string;
  /** Days past due of the oldest overdue invoice. */
  overdueDays: number | null;
  oldestOverdueInvoice: { id: string; invoiceNumber: string | null } | null;
  unappliedCredit: string;
}

export interface ClientOverviewProject {
  id: string;
  code: string;
  name: string;
  status: string;
  contractValue: string | null;
  outstanding: string | null;
}

export type ClientInvoiceCollectionStatus = 'CURRENT' | 'DUE_SOON' | 'OVERDUE';

export interface ClientOverviewUnpaidInvoice {
  id: string;
  invoiceNumber: string | null;
  projectId: string | null;
  projectName: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  balance: string;
  collectionStatus: ClientInvoiceCollectionStatus;
}

export interface ClientOverviewResponse {
  moneyVisible: boolean;
  /** null without money permission or with no projects. */
  metrics: ClientOverviewMetrics | null;
  projects: ClientOverviewProject[];
  /** null without money permission. */
  unpaidInvoices: ClientOverviewUnpaidInvoice[] | null;
}

export interface ClientActivityEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  actorName: string;
  /** Stable code: `client.create`, `client.contact.add`, `client.deactivate`, `invoice.posted`, `receipt.posted` … */
  action: string;
  /** Human sentence. Never carries an amount for a caller without money permission. */
  summary: string;
}

export type ClientActivityResponse = ClientActivityEntry[];
