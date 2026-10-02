# Clients redesign — API contract (2026-10-02)

The contract between the backend and the web for the client form, list and record. Owner decisions
(2026-10-02): personal webmail on a company is a **warning, not a block**; phones validated with
`libphonenumber-js` and stored **E.164**; Tax ID **optional**. Money follows one gate,
`view:financial-position` (`PERMISSIONS.financialPositionView`): without it every money field is
`null` (never `0`). Base path `/api/v1`. All writes are audited (`resource: 'client'`).

## Data model (migration)

`Client` gains:
- `registrationNumber String?` (VARCHAR 50) — business licence / company registration.
- `paymentTermsDays Int?` — default terms for this client's invoices (0–365).
- `countryCode String @default("SO")` (ISO-3166 alpha-2), `city String?` (VARCHAR 100); existing
  `address` stays as the street/building line.
- `invoiceEmail String?` — where invoices/statements go (falls back to the primary contact's email).

`ClientContact` gains:
- `whatsappPhone String?` — E.164; the number WhatsApp messages go to (usually the same as `phone`).
- `createdAt DateTime @default(now())`.
- Exactly one primary per client: partial unique index `ON client_contacts(client_id) WHERE is_primary`.
  The migration repairs existing data (no primary → earliest contact becomes primary; several →
  keep the earliest).

Existing phone values are left as stored; they are normalised the next time they are edited.

## Shared validation (server is the authority; the web mirrors it)

- **Names** (client, contact): trimmed, inner whitespace collapsed; 1–255.
- **Phone**: input `{ country: 'SO', number: '61 234 5678' }` *or* a full `'+25261…'` string. Parsed
  with `libphonenumber-js`; must be `isValid()`. Stored and returned as E.164 (`+252612345678`).
  Error: `400 { errorCode: 'PHONE_INVALID', field }`.
- **Email**: trimmed, lower-cased, RFC-ish check (`IsEmail`), max 254. Error `EMAIL_INVALID`.
- **Personal-email warning** (no block): web-only hint when type ∈ COMPANY/GOVERNMENT/NGO and the
  domain is a known free webmail (gmail.com, yahoo.com, hotmail.com, outlook.com, live.com, icloud.com,
  aol.com, proton.me, protonmail.com, ymail.com, mail.com, gmx.com).

## Endpoints

### Create — `POST /clients` (`create:client`)
```ts
{ name; type?; taxNumber?; registrationNumber?; paymentTermsDays?; countryCode?; city?; address?;
  invoiceEmail?; notes?;
  primaryContact: { name; role?; phone /* E.164 or {country,number} */; whatsappPhone?; email? } }
```
- `primaryContact` and its `phone` are **required** (a client is someone ACCO can reach).
- Returns the client (as `GET /clients/:id`).

### Update — `PATCH /clients/:id` (`manage:client`)
Same client fields (not contacts), all optional. `status` is no longer accepted here — use
deactivate/reactivate.

### Contacts (`manage:client`)
- `POST /clients/:id/contacts` `{ name; role?; phone; whatsappPhone?; email?; isPrimary? }` — the
  client's first contact is always primary; `isPrimary: true` demotes the current one (one tx).
- `PATCH /clients/:id/contacts/:contactId` `{ name?; role?; phone?; whatsappPhone?; email? }`.
- `POST /clients/:id/contacts/:contactId/make-primary`.
- `DELETE /clients/:id/contacts/:contactId` — `409 CONTACT_IS_PRIMARY` for the primary (make another
  primary first).

### Deactivate / reactivate (`manage:client`)
- `POST /clients/:id/deactivate` `{ reason }` (reason 3–500). Refused with
  `409 CLIENT_HAS_ACTIVE_PROJECTS` (any project not CLOSED/CANCELLED — use the project status enum)
  or `409 CLIENT_HAS_OPEN_BALANCE` (Σ outstanding of POSTED and OPENING_BALANCE invoices > 0).
- `POST /clients/:id/reactivate`.
- `GET /clients/:id` includes `allowedCommands: Array<'DEACTIVATE' | 'REACTIVATE'>` computed for the
  caller (permission + rules), and `deactivationBlockedBy: 'ACTIVE_PROJECTS' | 'OPEN_BALANCE' | null`.

### List — `GET /clients/summary`
Query: `search?` (name, code, any contact name — case-insensitive), `status?` (ACTIVE|INACTIVE),
`type?`, `balance?` (`OWES` | `OVERDUE`; ignored without money permission), `sort?`
(`name` | `-name` | `outstanding` | `-outstanding`; outstanding sorts ignored without money
permission), `page?` (1-based, default 1), `pageSize?` (default 25, max 100).
```ts
{ items: Array<{
    id; code; name; type; status;
    primaryContact: { name: string; phone: string | null } | null;
    activeProjectCount: number; totalProjectCount: number;
    outstanding: string | null;   // money gate
    overdue: string | null;       // money gate; Σ outstanding of POSTED + OPENING_BALANCE invoices with dueDate < today
  }>;
  total: number; page: number; pageSize: number; moneyVisible: boolean }
```
Outstanding = Σ `outstandingAmount` of POSTED client invoices (the figure Commercial uses) plus OPENING_BALANCE invoices migrated from the prior system (review M2);
unapplied client credit is **not** netted.

### Record overview — `GET /clients/:id/overview`
```ts
{ moneyVisible: boolean;
  metrics: null | {           // null without money permission or with no projects
    activeProjectCount; totalProjectCount;
    activeContractValue: string; outstanding: string; unpaidInvoiceCount: number;
    overdue: string; overdueDays: number | null;  // days past due of the oldest overdue invoice
    oldestOverdueInvoice: { id: string; invoiceNumber: string | null } | null;
    unappliedCredit: string;
  };
  projects: Array<{ id; code; name; status; contractValue: string | null; outstanding: string | null }>;
  unpaidInvoices: null | Array<{ id; invoiceNumber: string | null; projectId: string | null;
    projectName: string | null; dueDate: string | null; balance: string;
    collectionStatus: 'CURRENT' | 'DUE_SOON' | 'OVERDUE' }> }
```

### Activity — `GET /clients/:id/activity?limit=10`
`Array<{ id; at; actorName; action; summary }>` from the client's audit entries (create, update,
contact add/edit/make-primary/remove, deactivate/reactivate) plus invoices/receipts on the client
when the caller has money permission. `summary` never contains an amount for callers without it.

## Not in this round
Client-level statement export (only per-project exists); "Send invoice by WhatsApp" (needs the Meta
setup, ADR-042 phase 2).
