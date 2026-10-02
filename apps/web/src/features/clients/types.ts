import {
  ClientStatus,
  type AddClientContactRequest,
  type ClientActivityEntry as WireActivityEntry,
  type ClientCommand as WireClientCommand,
  type ClientContactView,
  type ClientDeactivationBlocker as WireDeactivationBlocker,
  type ClientDetailResponse,
  type ClientInvoiceCollectionStatus,
  type ClientListBalanceFilter,
  type ClientListItemView,
  type ClientListQuery,
  type ClientListResponse,
  type ClientListSort,
  type ClientOverviewMetrics as WireOverviewMetrics,
  type ClientOverviewProject as WireOverviewProject,
  type ClientOverviewResponse,
  type ClientOverviewUnpaidInvoice,
  type ClientTypeValue,
  type CreateClientRequest,
  type UpdateClientContactRequest,
  type UpdateClientRequest,
} from '@erp/types';

import type { Client as BaseClient, ClientContact as BaseClientContact } from '@/lib/api-types';

/*
 * Wire shapes come from `@erp/types` (`packages/types/src/clients.ts`, the clients-redesign
 * contract). The only local reshaping: `status` is narrowed to the `ClientStatus` enum the rest
 * of the web uses (the wire type spells it as the literal union), and `Client` keeps extending
 * the legacy `GET /clients` row that pickers elsewhere read.
 */

export { ClientStatus };

export type ClientType = ClientTypeValue;

export const CLIENT_TYPES: readonly ClientType[] = [
  'COMPANY',
  'GOVERNMENT',
  'NGO',
  'INDIVIDUAL',
  'OTHER',
];

/** Status order for the filter. Only two states exist. */
export const CLIENT_STATUS_ORDER: ClientStatus[] = [ClientStatus.ACTIVE, ClientStatus.INACTIVE];

/** A client contact. `phone` / `whatsappPhone` are E.164 once edited (older rows keep free text). */
export type ClientContact = BaseClientContact &
  Pick<ClientContactView, 'whatsappPhone'> &
  Partial<Pick<ClientContactView, 'createdAt'>>;

/**
 * `GET /clients` row and the client part of `GET /clients/:id`. The redesign's fields are
 * optional here only because the legacy `GET /clients` row predates them.
 */
export interface Client extends BaseClient {
  registrationNumber?: string | null;
  paymentTermsDays?: number | null;
  countryCode?: string | null;
  city?: string | null;
  invoiceEmail?: string | null;
}

export type ClientCommand = WireClientCommand;
export type ClientDeactivationBlocker = WireDeactivationBlocker;

/** `GET /clients/:id`. */
export type ClientDetail = Client &
  Omit<ClientDetailResponse, 'status' | 'contacts' | 'type'> & {
    status: ClientStatus;
    contacts: ClientContact[];
  };

// ─── List: GET /clients/summary ──────────────────────────────────────────────

export type ClientBalanceFilter = ClientListBalanceFilter;
export type ClientSummarySort = ClientListSort;
export type ClientSummaryQuery = Omit<ClientListQuery, 'status'> & { status?: ClientStatus };
export type ClientSummaryItem = Omit<ClientListItemView, 'status'> & { status: ClientStatus };
export type ClientSummaryPage = Omit<ClientListResponse, 'items'> & { items: ClientSummaryItem[] };

// ─── Record: GET /clients/:id/overview and /activity ─────────────────────────

export type ClientOverviewMetrics = WireOverviewMetrics;
export type ClientOverviewProject = WireOverviewProject;
export type CollectionStatus = ClientInvoiceCollectionStatus;
export type ClientUnpaidInvoice = ClientOverviewUnpaidInvoice;
export type ClientOverview = ClientOverviewResponse;
export type ClientActivityEntry = WireActivityEntry;

// ─── Writes ──────────────────────────────────────────────────────────────────

/** `POST /clients`. The web always sends phones as E.164. */
export type CreateClientPayload = CreateClientRequest;
/** `PATCH /clients/:id` — `null` clears a field, omission leaves it. No `status`, no contacts. */
export type UpdateClientPayload = UpdateClientRequest;
export type AddContactPayload = AddClientContactRequest;
export type UpdateContactPayload = UpdateClientContactRequest;

/** Error codes the client endpoints answer with (`ApiError.code`). */
export type ClientErrorCode =
  | 'PHONE_INVALID'
  | 'EMAIL_INVALID'
  | 'NAME_INVALID'
  | 'COUNTRY_INVALID'
  | 'PAYMENT_TERMS_INVALID'
  | 'FIELD_INVALID'
  | 'REASON_INVALID'
  | 'NO_CHANGES'
  | 'CONTACT_REQUIRED'
  | 'CONTACT_IS_PRIMARY'
  | 'CLIENT_HAS_ACTIVE_PROJECTS'
  | 'CLIENT_HAS_OPEN_BALANCE'
  | 'CLIENT_ALREADY_INACTIVE'
  | 'CLIENT_ALREADY_ACTIVE';
