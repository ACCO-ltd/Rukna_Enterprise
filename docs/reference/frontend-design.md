# Rukna ERP — Frontend Design Plan

Version: 2.0.0
Last Updated: 2026-08-06
Owner: Frontend Engineer (Abdimalik)
Reviewed by: Abdulsalam (Backend Engineer)
Status: **CANONICAL — implement against this document**

---

## Statement of Intent

The Rukna ERP frontend is a best-in-class enterprise construction platform. It is not a
CRUD interface over the API. Every design decision below was reached through structured
review of how ACCO Ltd's teams — from CEO to Site Engineer — actually think and work.

The guiding principle: **the Project is the primary context**. Users enter a project and
work within its dedicated workspace. Portfolio-level concerns live in a global sidebar.

---

## 1. Navigation Architecture

### 1.1 Global Sidebar

The global sidebar is always visible and grouped by business domain. It scales as future
modules (Procurement, Inventory, HR, Equipment) are introduced without redesign.

```
Dashboard              ← role-adapted home screen
───────────────────────
Portfolio
  Projects             ← portfolio list + card view; create project
  Clients              ← global client registry
───────────────────────
Finance                ← global receipts, AR aging, cash position
Operations             ← future: Procurement, Inventory, Logistics
Reports                ← cross-project reports (Sprint 9)
───────────────────────
Administration
  Users & Org          ← user management, org settings
  Roles & Permissions  ← role definition, permission assignment
  Workflows            ← approval chain viewer
  Exchange Rates       ← rate management
  Audit Logs           ← global audit trail
```

### 1.2 Project Workspace

Entering a project opens a dedicated workspace with its own navigation. The project
workspace is the primary working environment for Project Managers, Engineers, and QS staff.

**Current modules (Sprint 1–3 complete):**
```
Overview       ← Project Command Center
BOQ            ← versioned bill of quantities
Contracts      ← contract lifecycle + commercial terms
Applications   ← IPA list and detail
Certificates   ← IPC list and detail
Finance        ← project-scoped receipts and allocation
Members        ← project team management
Activity       ← chronological event timeline
```

**Future modules (Sprint 5–8, added without navigation redesign):**
```
Procurement    ← Sprint 5
Inventory      ← Sprint 6
Documents      ← Sprint 5
Reports        ← Sprint 9
```

### 1.3 Mobile Navigation (375px)

On mobile, the project workspace side-nav collapses into a **collapsible drawer**:

- Hamburger/menu icon in the page header opens the full module list
- The **current module name is always shown in the page header** for orientation
- The drawer remembers the last-opened project module across sessions
- The drawer provides quick access to recently visited projects
- Desktop retains the full visible sidebar — no information architecture change

Within individual modules, use **lightweight page-level tabs** for subviews (e.g., Finance
has tabs: Receipts | Allocations | Payment Status). No nested navigation deeper than this.

---

## 2. Platform Interaction Components

These four components must be built in **Tier 0** before any feature screen. Every module
depends on them. Building feature screens without them creates duplicated implementation.

### 2.1 `LifecycleCommandDrawer`

The standard pattern for every lifecycle transition across the entire platform. Used for:
Project approve/cancel/suspend, Contract execute/terminate, IPA submit/return/approve,
IPC supersede, and every future module transition.

**Always presents:**
```
Command name             (e.g. "Submit for Approval")
Current Status → New Status
Required input fields    (notes, reason, variance reason, etc.)
Business impact          (what will happen after confirmation)
Approval workflow preview (if a workflow is configured for this transition)
```

The underlying record stays visible behind the drawer. The drawer slides in from the right.
Confirm / Cancel buttons are always at the bottom. Destructive actions (Cancel Project,
Terminate Contract) use a red confirm button with explicit warning text.

### 2.2 `PlatformDataGrid`

The standard list presentation for every operational module. **All modules use this
component.** The Projects portfolio additionally supports a card view toggle.

**Capabilities:**
- Global search across visible columns
- Multi-filter (status, date range, assigned user, project, etc.)
- Sortable columns with persistent sort preference
- Saved views (user can save a filter+column configuration)
- Column visibility preferences
- Bulk selection with context-sensitive bulk actions
- Context-sensitive row actions (action menu adapts to the row's current status)
- Standardized status badges (see Section 6)
- Currency-aware formatting (`USD 6,840.00` — always with currency code)
- Sticky key columns (ref/name column pinned when scrolling right on mobile)
- Keyboard navigation (arrow keys, Enter to open, Escape to close)
- Export: Excel, CSV, PDF

### 2.3 `PermissionResolver`

A centralized service consumed by all components. **Never scatter permission-string checks
across individual components.**

```typescript
// Example API — exact implementation is the frontend engineer's decision
const { can, canAny, moduleVisible } = usePermissions();

can('approve:contract')           // boolean — show/disable a button
canAny(['create:ipa', 'view:ipa']) // boolean — any of these
moduleVisible('administration')    // boolean — hide entire sidebar section
```

**Critical rule:** `PermissionResolver` is for **presentation only**. It improves UX by
hiding unavailable actions and locked modules. It does NOT replace backend authorization.
Every API call is still subject to:
- Backend permission checks
- Organization/project scope enforcement
- Project membership validation
- Lifecycle state rules
- Workflow requirements

Disable (with tooltip) rather than hide when showing the permission boundary is useful to
the user. Hide entire modules when the user has zero access to them.

### 2.4 Shared Formatters

Platform-wide utilities, never reimplemented per component:

```
formatCurrency(amount, currency)   → "USD 6,840.00"
formatDate(iso)                    → locale-aware, respects EN/AR
formatStatus(status, entityType)   → StatusBadge with correct token
formatDecimal(value, precision)    → never raw JS float arithmetic
relativeTime(iso)                  → "3 hours ago" / "in 2 days"
```

---

## 3. Project Command Center (Overview Tab)

The Overview tab is the first screen seen when opening a project. It must immediately
answer: **is this project healthy, and what needs my attention right now?**

### 3.1 Project Health Header

A persistent strip at the top of every project workspace page:

```
[Status Badge]  Ring Road Phase 2  |  USD 1,240,000  |  67% Progress
|  84% Budget Utilized  |  47 Days Remaining  |  [⚠ SUSPENDED]
```

### 3.2 KPI Card Grid

A **configurable** grid of KPI cards. Default configuration for Sprint 3:

```
Active Contracts     Pending Applications    Outstanding Certificates
Cash Collected       Outstanding Receivables  Budget vs Actual
Open Risks           Open Issues
```

Each card navigates directly to the corresponding project-scoped module tab. The grid is
configurable — future sprints can add cards (Procurement commitments, Labour cost to date,
Equipment hours this week) without rebuilding the Overview.

Cards are built as **reusable dashboard widgets** so the same components power the global
Portfolio Dashboard and any future mobile application.

### 3.3 Information Panels

Four panels below the KPI grid:

| Panel | Content |
|---|---|
| **Milestones** | Upcoming and recently completed, due date, % complete |
| **Recent Activity** | Last 10 events from the project Activity feed |
| **Attention Required** | Items from `GET /projects/:id/attention-items` |
| **Financial Summary** | Gross certified, deductions, net payable, collected, outstanding |

---

## 4. Form Design System

**Rule:** form complexity and financial significance determine the tier, not just line items.

| Tier | Form Type | Used For |
|---|---|---|
| **Side Sheet** | Simple focused create/edit, retains context behind | Add client, create receipt, add team member, set retention terms, add guarantee, add milestone, add advance term |
| **Full-Page Wizard** | Multi-step, line-item tables, complex workflows, financially significant | Create project, issue IPC, create IPA, initialize BOQ, create contract, accounting journals (Sprint 4), period close (Sprint 9) |

---

## 5. IPC Issuance Wizard (Tier 1 — Priority)

The most complex form in Sprint 3 frontend. Full-page, three-step wizard.

### Rejected application (short path)
If the engineer selects REJECTED status on Step 1, Steps 2 and 3 collapse. Only a rejection
reason field is shown. Issue immediately.

### CERTIFIED / PARTIALLY_CERTIFIED (full path)

**Step 1 — Certificate context**
- Status: CERTIFIED / PARTIALLY_CERTIFIED
- Currency + exchange rate snapshot fields
- Notes (optional)

**Step 2 — Line-item certification**

Table columns: BOQ Node name | Measurement method | Cumulative claimed | Previously certified
| Cumulative certified (editable) | Unit rate (read-only from BOQ) | Certified amount (computed)

- Supports QUANTITY, PERCENTAGE, and MILESTONE measurement methods
- Compares **cumulative certified** against **cumulative claimed** (not period quantities)
- `varianceReason` field appears **inline on the row** the moment certified ≠ claimed
- Running gross certified total updates as the user types
- Backend recalculates `certifiedAmount` on blur (never trust client-side multiplication alone)

**Step 3 — Deductions and final review**

```
Gross Certified Total:               USD 9,000.00
─────────────────────────────────────────────────
Contract deductions (read-only, auto-generated):
  Retention (5.00%):               − USD   450.00
  Advance Recovery (10.00%):       − USD   900.00
─────────────────────────────────────────────────
Ad-hoc adjustments (editable table):
  TAX                              − USD    45.00
─────────────────────────────────────────────────
Net Payable:                         USD 7,605.00
```

- Contract-derived deductions (RETENTION, ADVANCE_RECOVERY) are **read-only**. Do not
  render input fields for these — the server computes and auto-generates them.
- Ad-hoc adjustment types (TAX, CONTRA, OTHER) are entered by the user in an editable table.
- "Issue Certificate" button is the final action. Once issued, the certificate is **immutable**.

**Technical requirements:**
- Draft persistence: wizard state saved to sessionStorage so refresh does not lose work
- Autosave: after Step 2 completion, POST a draft to the backend (if endpoint available)
- Optimistic concurrency: detect if the IPA was modified while the wizard was open
- Immutable on issue: disable all editing after POST /ipc succeeds

---

## 6. Status Token System

Status is presented via six semantic platform tokens. **Never map status strings to raw
colors directly.** Use the central status registry.

| Token | Meaning | Example States |
|---|---|---|
| `NEUTRAL` | Not started, inactive | DRAFT, INACTIVE, UNKNOWN |
| `IN_PROGRESS` | Moving through a workflow | UNDER_REVIEW, PENDING_INTERNAL_APPROVAL, PENDING_SIGNATURE, APPROVED_FOR_SUBMISSION, SUBMITTED, MOBILIZING |
| `WARNING` | Needs attention, partial, at risk | RETURNED_FOR_REVISION, SUSPENDED, FINAL_ACCOUNT_PENDING, PARTIALLY_CERTIFIED, PARTIALLY_PAID, EXPIRING_SOON |
| `SUCCESS` | Healthy, complete, approved | ACTIVE, APPROVED (final), BASELINED, CERTIFIED, EXECUTED, PAID, COMPLETED, CLOSED |
| `DANGER` | Stopped, failed, urgent | CANCELLED, REJECTED, TERMINATED, OVERDUE, EXPIRED |
| `HISTORICAL` | No longer active, for reference | SUPERSEDED, ARCHIVED, REPLACED |

**Context matters:** `APPROVED` on a Project is `IN_PROGRESS` (still mobilizing). `APPROVED`
on a final payment document is `SUCCESS`. The registry resolves this by entity type.

**Muted variants:** CLOSED and CANCELLED use a muted/ghost variant of NEUTRAL — they are
terminal but not urgent.

**Accessibility rules (non-negotiable):**
- Status text is always shown alongside the color badge. Never color-only.
- All badge variants must meet WCAG AA contrast in both light and dark modes.
- Status badges render correctly in RTL (Arabic) layout.

---

## 7. Attention Items (Backend Requirement)

The `AttentionQueryService` is a **backend task** (not a frontend derivation). The frontend
is a consumer of these endpoints.

**Endpoints:**
```
GET /attention-items               ← portfolio-level (all projects the user can access)
GET /projects/:id/attention-items  ← scoped to one project
```

**Response shape (per item):**
```json
{
  "id": "...",
  "severity": "URGENT | WARNING | INFO",
  "category": "APPROVAL | EXPIRY | PAYMENT | MILESTONE | SUSPENSION",
  "title": "IPA-003 awaiting your approval",
  "description": "Ring Road Phase 2 — submitted 3 days ago",
  "entityType": "InterimPaymentApplication",
  "entityId": "cld...",
  "projectId": "cld...",
  "actionUrl": "/projects/cld.../applications/cld..."
}
```

**Alert rules the service must compute (minimum):**
- IPA in PENDING_INTERNAL_APPROVAL and the current user is in the approval chain
- Contract guarantee expiring within 30 days
- IPC with status UNPAID for more than 30 days
- Contract milestone past due date and not completed
- Project suspended for more than 14 days
- Advance recovery balance outstanding on a FINAL_ACCOUNT_PENDING contract
- Retention pending release (practical completion reached, DLP period elapsed)

The same endpoint contract will be backed by a persistent notification engine in a later
sprint without requiring frontend changes.

---

## 8. Build Sequence

Build in this order. Do not start a tier before the previous is complete.

### Tier 0 — Platform Foundations (build first, always)
1. `PermissionResolver` service and `usePermissions` hook
2. `PlatformDataGrid` MVP (search, filter, sort, status badges, currency formatting)
3. `LifecycleCommandDrawer` component
4. Shared formatters (`formatCurrency`, `formatDate`, `formatStatus`, `formatDecimal`, `relativeTime`)

### Tier 1 — Billing Completion
5. IPC issuance wizard (3-step full-page, short rejection path)
6. Payment and allocation status view (per certificate: allocated, net certified, status)
7. IPC supersession flow (via `LifecycleCommandDrawer`)

### Tier 2 — Administration
8. Users + org memberships (list, invite, deactivate, assign roles)
9. Roles + permission assignment (unified screen: define role, assign permissions)
10. Project membership management (add/remove members, assign project roles)
11. Org settings (name, logo, default currency, timezone)

### Tier 3 — Governance Visibility
12. Workflow definition viewer (see configured approval chains per transaction type)
13. Audit logs viewer (global, filterable by user/entity/date)
14. Project Activity feed (chronological timeline in project workspace)

### Tier 4 — Operational Intelligence
15. Backend: `AttentionQueryService` + `GET /attention-items` + `GET /projects/:id/attention-items`
16. Portfolio attention panel (global dashboard)
17. Project attention panel (project Overview)

### Tier 5 — Financial Configuration
18. Exchange rates management (list rates, add new rate, view history)
19. Advanced workflow administration (create/edit approval chains — if scope confirmed)

### Tier 6 — Refinement
20. `PlatformDataGrid` enhancements (saved views, bulk actions, export)
21. Dashboard widget extraction (make project overview cards reusable for portfolio)
22. Migrate remaining lists to `PlatformDataGrid`

---

## 9. Non-Negotiable Platform Rules

These apply to every screen, every component, every engineer:

| Rule | Detail |
|---|---|
| **Single API client** | All calls go through `src/lib/api-client.ts`. No ad-hoc fetch. |
| **TanStack Query for all server state** | No `useEffect + useState` for data fetching. |
| **Bilingual from day one** | Every user-visible string through `next-intl`. No hardcoded English. |
| **RTL layout** | All components must render correctly in Arabic (RTL). Test before shipping. |
| **Mobile-first, 375px** | Every screen works at 375px. Touch targets ≥ 44×44px. |
| **No localStorage for financial data** | Never cache sensitive amounts, tokens, or org data in localStorage. |
| **Access token in memory only** | Never in localStorage. HttpOnly cookie handles refresh. |
| **Backend is authoritative** | `PermissionResolver` is UX only. All enforcement happens on the server. |
| **Currency always with code** | `USD 6,840.00` — never a bare number for a monetary value. |
| **Status text always with badge** | Never rely on color alone for status. Accessible contrast required. |
| **Dark mode** | All status tokens and components must meet WCAG AA in both light and dark modes. |

---

## 10. Backend Tasks Introduced by This Plan

The following backend work is required to support the frontend design. These are not yet
in the sprint plan and must be scheduled.

| Task | Endpoint | Sprint |
|---|---|---|
| `AttentionQueryService` | `GET /attention-items` | Before Tier 4 |
| `AttentionQueryService` | `GET /projects/:id/attention-items` | Before Tier 4 |

All other frontend screens consume endpoints already built in Sprints 1–3.

---

## 11. Accounting Workspace — Sprint 4 Frontend

The backend for Sprint 4 is complete, tested, and API-ready. This section is the build plan
for the accounting workspace. The intended reader is **Abdimalik (Frontend Engineer)**.

**Backend contact:** All accounting API questions go to Abdulsalam. All business rule
questions (e.g., "what does locked mean for a period?") go to Eng Ahmed Shirie.

**API reference:** `api-reference.md` Section 6.13–6.23 documents every endpoint used here.

---

### 11.1 Where Accounting Lives in the Navigation

Accounting is a **company-wide** function, not project-scoped. It lives in the global sidebar
under **Finance**, not inside the project workspace.

**Updated global sidebar:**
```
Dashboard
───────────────────────
Portfolio
  Projects
  Clients
───────────────────────
Finance
  Overview              ← cash position, AR/AP summary (existing)
  Accounting            ← NEW — Sprint 4 accounting workspace
    Chart of Accounts
    Fiscal Years
    Manual Journals
    Accounts Receivable
    Accounts Payable
    General Ledger
    Reports
    Period Management
  Receipts              ← existing Sprint 3 receipt tracking
───────────────────────
Administration
  ...
```

The **Accounting** node is a nested section inside Finance. It can be a collapsible group
or a sub-sidebar, depending on screen width. At 375px, it collapses into the Finance drawer.

---

### 11.2 Permission Gating

Before rendering any accounting page, check:

| Permission | Guards |
|---|---|
| `view:accounting` | All accounting pages (read-only views) |
| `manage:journals` | Create, submit, approve, post, reverse manual journals |
| `manage:ar` | Post client invoices; post/allocate receipts |
| `manage:ap` | Create/post supplier bills and payments |
| `manage:periods` | Lock, close, reopen periods; rebuild snapshots |
| `manage:year-end` | Year-end close (CFO only) |

If the user lacks `view:accounting`, redirect to `/` with an access-denied notice.

Use the existing `PermissionResolver` pattern from Section 4.5. All these checks are UX
only — the backend enforces them independently.

---

### 11.3 Build Order

Build screens in this sequence. Each tier unlocks the next.

```
Tier A — Setup (no transactions yet, but required before anything else)
  A1. Chart of Accounts
  A2. Fiscal Years and Periods

Tier B — Transaction entry
  B1. Manual Journals
  B2. Client Invoices (AR)
  B3. Customer Receipts and Allocations (AR)
  B4. Supplier Bills (AP)
  B5. Supplier Payments and Advance Allocations (AP)

Tier C — Reporting (read-only, high CEO/CFO value)
  C1. Account Ledger and GL Balance
  C2. Trial Balance
  C3. Profit & Loss
  C4. Balance Sheet
  C5. Monthly P&L Comparison

Tier D — Period management (CFO-only operations)
  D1. Period List with Status
  D2. Period Close Workflow (lock → close-gate → close)
  D3. Period Reopen
  D4. Snapshot Rebuild
  D5. Year-End Close Wizard
```

---

### 11.4 Tier A — Setup Screens

#### A1. Chart of Accounts

**Route:** `/finance/accounting/chart-of-accounts`

**Data:** `GET /accounts`

**What to show:**
- Filterable/sortable table: Code | Name | Arabic Name | Class | Subtype | Normal Balance | Control Account | Effective From | Status
- Group rows by `accountClass` with collapsible sections (Assets, Liabilities, Equity, Income, Cost of Sales, Expenses)
- "New Account" button → slide-over form with all required fields
- Click a row → Account Detail slide-over showing version history (why it was changed + who changed it)
- Badge on control accounts: `CONTROL` in amber — with tooltip "Only the system can post to this account"

**Form fields for creating an account:**
```
Code *              text
Name *              text
Arabic Name         text (RTL)
Account Class *     select: ASSET / LIABILITY / EQUITY / INCOME / COST_OF_SALES / EXPENSE
Account Subtype *   select (filtered by class — see API docs for valid subtypes)
Normal Balance *    select: DEBIT / CREDIT (auto-suggested based on class)
Posting Allowed     toggle (default: true)
Control Account     toggle (default: false; if true, show warning)
Effective From *    date picker
```

**Bulk import:** Secondary button "Import COA" → CSV upload → preview table → confirm.
Body format documented in `api-reference.md` Section 6.13.

---

#### A2. Fiscal Years and Periods

**Route:** `/finance/accounting/fiscal-years`

**Data:** `GET /fiscal-years` → list; `GET /fiscal-years/:id` → detail with periods

**What to show:**
- List of fiscal years with year name, status (OPEN / CLOSED), date range
- Click a fiscal year → Period list showing all 12 periods with their status:

```
Period       Start         End          Status    Actions
January      2025-01-01    2025-01-31   LOCKED    [Close] [Close Gate]
February     2025-02-01    2025-02-28   OPEN      [Lock]
...
December     2025-12-01    2025-12-31   OPEN      [Lock]
```

- Status badge colors:
  - `OPEN` → blue
  - `LOCKED` → amber (ready to close, awaiting reconciliation)
  - `CLOSED` → green
  - `REOPENED` → orange (attention — journals may be pending)

- "New Fiscal Year" button → modal asking for `year` (integer) and `retainedEarningsAccountCode`

> The API generates all 12 periods automatically. You do not need to create them individually.

**Period action buttons** (always check `can('manage:periods')` before rendering):
- `[Lock]` visible on OPEN and REOPENED periods → calls `POST /periods/:id/lock`
- `[Close Gate]` visible on LOCKED periods → calls `GET /periods/:id/close-gate` → shows blocker list in a modal
- `[Close]` visible on LOCKED periods → only enable if close-gate passed → calls `POST /periods/:id/close`
- `[Reopen]` visible on CLOSED periods → requires reason text → calls `POST /periods/:id/reopen`

> Show the close-gate result to the CFO **before** they click Close. Never skip the pre-flight check.

---

### 11.5 Tier B — Transaction Entry Screens

#### B1. Manual Journals

**Route:** `/finance/accounting/journals`

**List data:** `GET /journals?status=DRAFT` (add status filter tabs: All | Draft | Submitted | Approved | Posted | Reversed)

**What to show:**
- Table: Journal No. | Date | Description | Total Debit | Status | Created By | Actions
- Click a row → Journal Detail page
- "New Journal" button → Journal Create form

**Journal create form:**
```
Accounting Date *   date picker (must fall in an OPEN/REOPENED period — validate client-side, enforce server-side)
Description *       text
Currency *          select (default: USD)
Lines section:
  [Account Code]  [Account Name (auto-fill)]  [Debit]  [Credit]  [Memo]  [Project]  [Dept]
  + Add Line button
  Running totals: Total Debit | Total Credit | Difference (must be 0 to submit)
```

Validate `∑ debit = ∑ credit` before enabling the Save button. Show the difference inline.

**Journal detail page actions (role-gated):**
- `Submit` (DRAFT → SUBMITTED): accountant action
- `Approve` / `Reject` (SUBMITTED → APPROVED / REJECTED): CFO action; rejection requires reason text
- `Post` (APPROVED → POSTED): accountant action
- `Reverse` (POSTED → REVERSED): requires reversal date and reason; CFO approval required for reversals

**Journal line display:** Show debit in green column, credit in orange column — never mixed.

---

#### B2. Client Invoices

**Route:** `/finance/accounting/invoices`

**List data:** `GET /invoices`

**What to show:**
- Table: Invoice No. | Client | IPC Ref | Invoice Date | Due Date | Amount | Outstanding | Status | Posting Status
- Filter tabs: All | Draft | Approved | Posted | Reversed
- "Generate from IPC" button → modal to pick an IPC and set invoice date / due date

**Invoice detail actions:**
- `Approve`: changes `documentStatus` from DRAFT → APPROVED
- `Post to GL`: requires `arAccountCode`, `revenueAccountCode`, `vatAccountCode` — show account picker inputs in a modal
- `Reverse`: requires reversal date and reason

> When `postingStatus = POSTED`, show the journal entry number as a link. Clicking it navigates to the drill-down view (`GET /reports/drill-down?sourceDocumentType=CLIENT_INVOICE&sourceDocumentId=...`).

---

#### B3. Customer Receipts and Allocations

**Route:** `/finance/accounting/receipts`

> Note: This is the **accounting** receipt screen. The project-scoped Finance tab (Sprint 3) continues to exist for project managers tracking cash at the project level. These are distinct views of the same entity.

**List data:** `GET /receipts`

**What to show:**
- Table: Receipt No. | Client | Bank Account | Date | Amount | Unallocated | Posting Status
- Click a row → Receipt Detail with allocation table

**Receipt detail:**
- Posting section: if `postingStatus = NOT_POSTED`, show "Post to GL" button → modal asks for `bankAccountCode`, `arAccountCode`, `unappliedAccountCode`
- Allocations table: invoice | amount allocated | allocation date | actions
- "Allocate to Invoice" button → modal with invoice search + amount input (capped at `unallocatedAmount`)
- Reverse an allocation: per-row button on the allocations table

---

#### B4. Supplier Bills

**Route:** `/finance/accounting/bills`

**List data:** `GET /bills`

**What to show:**
- Table: Bill Ref | Supplier | Supplier Invoice No. | Bill Date | Due Date | Amount | Status | Posting Status
- Filter by status tabs: All | Draft | Submitted | Approved | Posted | Reversed
- "New Bill" button → bill create form

**Bill create form:**
```
Supplier *           entity picker (search suppliers)
Supplier Invoice No. text
Bill Date *          date
Due Date *           date
Currency *           select
Lines:
  [Description]  [Qty]  [Unit Price]  [Amount]  [Posting Profile]
  + Add Line
Total shown at bottom
```

**Bill detail actions:** Submit → Approve/Reject → Post (modal: `apAccountCode`) → Reverse

---

#### B5. Supplier Payments and Advance Allocations

**Route:** `/finance/accounting/payments`

**List data:** `GET /payments`

**What to show:**
- Table: Payment No. | Supplier | Bank | Date | Amount | Posting Status | Allocations
- "New Payment" button → payment create form

**Payment create form:**
```
Supplier *           entity picker
Bank Account *       select from configured bank accounts
Payment Date *       date
Accounting Date *    date (same as payment date by default)
Currency *           select
Total Amount *       number
Payment Method *     select: BANK_TRANSFER / CHEQUE / CASH
```

**Payment detail actions:**
- Approve / Reject
- Post to GL → modal: `apAccountCode`, `bankGlCode`, `supplierAdvanceCode`
- Allocate to Bill (if posted) → modal: select bill + amount
- Reverse Allocation → per-allocation row action
- Reverse Payment

---

### 11.6 Tier C — Reporting Screens

All report screens are in the Finance → Accounting → Reports section.

**Route prefix:** `/finance/accounting/reports/`

**Common requirements for all report screens:**
- Date pickers for the report period
- Export to PDF button (print-optimized layout)
- Export to Excel / CSV button
- All monetary amounts formatted as `formatCurrency(amount, currencyCode)` — never bare numbers
- Report header: Organization name | Report title | Period | "As of" date | "Generated at" timestamp
- Loading skeleton while data is fetching (TanStack Query)
- Error state if `balanced: false` is returned — display as a red alert, not as a normal table row

---

#### C1. Account Ledger

**Route:** `/finance/accounting/reports/ledger/:accountId`

**Data:** `GET /reports/ledger/:accountId?fromDate=...&toDate=...`

**Controls:** Account picker (search by code or name) | From date | To date | (Optional) Project filter | Department filter

**Display:**
```
Account: 1010 — Cash at Bank
Period: Jan 1, 2025 – Jan 31, 2025

Opening Balance:  USD 48,500.00

Date        Journal No.   Description                     Debit        Credit      Balance
2025-01-10  JE-000001     Receipt from Baraka Real Est.   6,000.00                54,500.00
2025-01-15  JE-000002     Office rent accrual                          2,500.00   52,000.00

Closing Balance:  USD 52,000.00
```

Clicking a journal number navigates to the Journal Detail page for that entry.
Clicking a source document (e.g., "PAYMENT_RECEIPT") shows the drill-down panel for that document.

---

#### C2. Trial Balance

**Route:** `/finance/accounting/reports/trial-balance`

**Data:** `GET /reports/trial-balance?asOfDate=...&includeZeroBalance=false`

**Controls:** As of date | Toggle: Include zero-balance accounts

**Display:**

```
Trial Balance — As of January 31, 2025

Account Code  Account Name          Opening Dr    Opening Cr    Period Dr    Period Cr    Closing Dr    Closing Cr
───────────────────────────────────────────────────────────────────────────────────────────────────
ASSETS
1010          Cash at Bank          48,500.00     —             6,000.00     2,500.00     52,000.00     —
...
───────────────────────────────────────────────────────────────────────────────────────────────────
TOTALS                              100,000.00    100,000.00    15,000.00    15,000.00    115,000.00    115,000.00

✓ Balanced
```

If `balanced: false`, show a red banner: "Warning: Trial balance is not balanced. Contact Abdulsalam immediately."

Group rows by `accountClass` with subtotals per class.

---

#### C3. Profit & Loss

**Route:** `/finance/accounting/reports/pl`

**Data:** `GET /reports/pl?fromDate=...&toDate=...` (optional: `&projectId=...` `&departmentId=...`)

**Controls:** From date | To date | (Optional) Project filter | Department filter

**Display:**
```
Profit & Loss — January 1, 2025 to January 31, 2025

REVENUE
  Project Revenue         85,000.00
─────────────────────────────────
  Total Revenue           85,000.00

COST OF SALES
  (none)
─────────────────────────────────
  Total Cost of Sales          0.00

GROSS PROFIT              85,000.00

OPERATING EXPENSES
  Office Rent              2,500.00
  Site Costs               9,500.00
─────────────────────────────────
  Total Expenses          12,000.00

═════════════════════════════════
NET INCOME                73,000.00
```

When a project or department filter is active, show the filter as a chip above the report:
`Filtered by: Project — Baraka Tower [×]`

---

#### C4. Balance Sheet

**Route:** `/finance/accounting/reports/balance-sheet`

**Data:** `GET /reports/balance-sheet?asOfDate=...` (optional: `&comparativeDate=...`)

**Controls:** As of date | Comparative date (optional prior period)

**Display:**
```
Balance Sheet — January 31, 2025
                                         Jan 31, 2025    Dec 31, 2024

ASSETS
  Cash at Bank             1010            52,000.00       48,500.00
  Accounts Receivable      1200           103,000.00       ...
  ─────────────────────────────────
  Total Assets                            155,000.00      100,000.00

LIABILITIES
  Accounts Payable         2000            10,000.00
  ─────────────────────────────────
  Total Liabilities                        10,000.00

EQUITY
  Retained Earnings        3100            72,000.00
  Current Year Earnings    —               73,000.00
  ─────────────────────────────────
  Total Equity                            145,000.00

═══════════════════════════════════
Total Liabilities and Equity               155,000.00

✓ Balanced
```

> The "Current Year Earnings" row has `accountId = "CURRENT_YEAR_EARNINGS"` — it is a computed
> line, not a real account. Render it in italic with a note: "Live P&L — not yet closed". This row
> disappears after year-end close.

If `balanced: false`, show a red alert: "Balance Sheet does not balance. Contact Abdulsalam."

---

#### C5. Monthly P&L Comparison

**Route:** `/finance/accounting/reports/pl-monthly/:fiscalYearId`

**Data:** `GET /reports/pl/monthly/:fiscalYearId` (optional: `&projectId=...`)

**Controls:** Fiscal year picker | (Optional) Project filter

**Display:**

```
Monthly P&L — FY2025

                     Jan 2025    Feb 2025    Mar 2025    ...    Total
─────────────────────────────────────────────────────────────────
Revenue              85,000      92,000      77,000             254,000
Cost of Sales             0           0           0                   0
Gross Profit         85,000      92,000      77,000             254,000
Expenses             12,000      11,500      13,200              36,700
Net Income           73,000      80,500      63,800             217,300
```

Highlight the current period column. Allow click-through: clicking a period column navigates
to the P&L detail for that period (`/reports/pl` with `fromDate`/`toDate` pre-filled).

---

### 11.7 Tier D — Period Management (CFO Screen)

**Route:** `/finance/accounting/periods`

This is the master period management view. Gate with `can('manage:periods')` — accountants
can view but not act.

**What to show:**

A page-level fiscal year selector at the top. Below it, a card grid of all 12 periods for the
selected fiscal year.

Each period card:
```
┌─────────────────────────────────┐
│ January 2025         [LOCKED]   │
│ Jan 1 – Jan 31                  │
│                                 │
│ Journals in period:  14         │
│ AR reconciliation:   ✓ Cleared  │
│ AP reconciliation:   ✓ Cleared  │
│                                 │
│ [Close Gate]  [Close Period]    │
└─────────────────────────────────┘
```

Status badge colors match Section A2.

**Close Gate modal (Tier D only):**

When the CFO clicks "Close Gate", call `GET /periods/:id/close-gate` and show a modal:

```
Close Gate — January 2025

✓ No unposted journals
✓ AR reconciliation passed (GL: 103,000 = Subledger: 103,000)
✗ AP reconciliation FAILED (GL: 10,000 ≠ Subledger: 12,500 — variance: 2,500)

[ Run Again ]   [ Cancel ]
```

Only enable "Close Period" if `passed: true`. If blockers exist, disable it and show:
"Resolve all blockers before closing."

**Year-End Close Wizard:**

Visible only in the December period card of a fiscal year. Button: "Run Year-End Close"
guarded by `can('manage:year-end')`.

Step 1 — Confirm: "This will post the year-end closing journal, zero all P&L accounts, and
transfer net income to Retained Earnings. This cannot be undone without reopening Period 12."

Step 2 — Account confirmation: show the Retained Earnings account that was configured for this
fiscal year. Ask CFO to confirm.

Step 3 — Post: call `POST /periods/fiscal-year/:fiscalYearId/close`. Show a progress spinner.

Step 4 — Result: "Year-end close complete. FY2025 is now CLOSED. Net income of USD 217,300
has been transferred to Retained Earnings account 3100."

---

### 11.8 Opening Balance Wizard (One-Time)

**Route:** `/finance/accounting/setup/opening-balance`

**Data:** `POST /accounting/opening-balance`

This wizard runs once per organization when going live. Show it prominently in a "Setup
Checklist" at the top of the Accounting home screen if opening balances have not been posted.

**Steps:**

1. Cutover date and batch reference
2. Trial balance entry (table: account code | debit balance | credit balance)
   - Live validation: ∑ debit = ∑ credit before allowing "Next"
3. Open AR invoices (client | invoice ref | amount | due date)
4. Open AP bills (supplier | bill ref | amount | due date)
5. Review and confirm
6. Submit — call `POST /accounting/opening-balance`

After submission, mark the "Opening Balances" item in the setup checklist as complete.
Opening balances cannot be re-run after live transactions have been posted (the backend enforces this).

---

### 11.9 Common Component Patterns

These patterns apply across all accounting screens.

**`<MoneyDisplay amount={...} currency="USD" />`**
Always renders `USD 6,840.00`. Never render a raw number for a financial amount.

**`<BalanceAlert balanced={boolean} />`**
Red alert box: "GL is out of balance — contact Abdulsalam immediately." Renders only when `balanced: false`.

**`<JournalStatusBadge status="POSTED" />`**
Color map:
- DRAFT → gray
- SUBMITTED → blue
- APPROVED → indigo
- POSTED → green
- REJECTED → red
- REVERSED → orange

**`<PeriodStatusBadge status="LOCKED" />`**
- OPEN → blue
- LOCKED → amber
- CLOSED → green
- REOPENED → orange

**`<AccountPicker onSelect={...} />`**
Searchable dropdown that calls `GET /accounts`, filterable by code or name. Used everywhere an account needs to be picked (journal lines, posting modal accounts, etc.).

**`<DrilldownPanel sourceDocumentType="CLIENT_INVOICE" sourceDocumentId="..." />`**
Slide-over panel that calls `GET /reports/drill-down?...` and lists all journal entries linked to the source document. Used in Invoice Detail, Receipt Detail, Bill Detail, and Payment Detail.

**Decimal precision:**
All financial inputs must accept exactly 2 decimal places. Do not allow 3+ decimal places — the backend stores `Decimal(20,6)` but the UI must enforce business rounding to 2dp. Use a currency input mask.

---

### 11.10 Error States

| Server response | What to show |
|---|---|
| `400 Period is locked` | "This accounting date falls in a locked period. Use an open period." |
| `400 Period is closed` | "This accounting date falls in a closed period. It cannot accept postings." |
| `400 Debits do not equal credits` | "Journal is not balanced — total debits must equal total credits." |
| `400 Account is a control account` | "Account [code] is a control account. Manual journals cannot be posted to it." |
| `400 Close gate failed` | Show the `blockers` array from the response, one per line in a modal. |
| `400 AR/AP reconciliation failed` | "Period cannot be closed — AR or AP reconciliation failed. See close gate for details." |
| `409 Fiscal year already exists` | "A fiscal year for [year] already exists for this organization." |
| `403` (any) | "You do not have permission to perform this action." |
| `500` (any) | "Something went wrong. Please try again or contact support." |

---

### 11.11 Accounting Navigation Update (Summary)

This is the final updated global sidebar section:

```
Finance
  Overview              ← cash position, AR/AP aging (existing)
  Accounting
    Setup
      Chart of Accounts
      Fiscal Years
      Opening Balances  ← show only until completed
    Journals            ← Manual Journals
    Receivables
      Client Invoices
      Customer Receipts
    Payables
      Supplier Bills
      Supplier Payments
    Reports
      Account Ledger
      Trial Balance
      Profit & Loss
      Balance Sheet
      Monthly P&L
    Periods             ← CFO only; gated by manage:periods
  Receipts              ← Sprint 3 project-level receipts (unchanged)
```

The Setup group can be collapsed by default once the one-time wizard is complete. Keep
"Chart of Accounts" and "Fiscal Years" always accessible after setup.

---

## 12. Procurement Workspace — Sprint 5 Frontend

This section is the build spec for everything under the **Procurement** sidebar group. Read `api-reference.md` sections 6.24–6.32 alongside this spec — every field name, status value, and rule referenced here maps 1:1 to those endpoint docs.

> ### ⚠️ Built 2026-08-09 — where this section is wrong
>
> The contract sweep run before the build found seventeen divergences between §6.24–6.32 and the controllers, recorded as the **P-series** in `docs/backend-requests/frontend-blockers.md`. Several of them make instructions in this section impossible to follow. What shipped, and why:
>
> | This section says | What was built | Why |
> |---|---|---|
> | §12.4 status filter on units and materials | No filter; an "active only" notice instead | The service hard-codes `ACTIVE` and no controller takes a `status` parameter (P2) |
> | §12.5 Close action on `APPROVED` / `PARTIALLY_ORDERED` | No Close button | No endpoint reaches `CLOSED` (P4) |
> | §12.6 PO list "Total Amount" | Column omitted | The list response embeds no lines (P14) |
> | §12.6 PO list "Revision" | Labelled "latest revision" | The embedded revision is the highest-numbered, not the ACTIVE one (P14) |
> | §12.6 approve drawer: "its uncommitted balance will be reversed" | Says the revision is superseded and new entries written; warns that the reversal is for the **full** original value | Supersede over-reverses; a revision received against goes negative (P11) |
> | §12.7 "exceeds the ordered quantity by more than 5%" | Warning quotes no percentage | Tolerance comes from an `OverReceiptPolicy` no endpoint exposes (P9) |
> | §12.7 "resolve via PO revision" for `EXCEPTION_PENDING` | Says only Cancel is available | PO revision never re-evaluates a held receipt (P10) |
> | §12.7 pre-populate one line per PO line | Pre-populated, but untouched rows are **omitted from the payload** | `@IsPositive()` on received/accepted `400`s a zero row (P6) |
> | §12.7 `qualityStatus: REJECTED` | Not offered | It requires `acceptedQuantity: 0`, which the API refuses (P6) |
> | §12.10 `MaterialPicker` calls `?search=` | Filters the fetched catalogue in memory | No `search` parameter exists (P1) |
> | §12.12 sidebar item `/procurement/bill-matching` | No such item | §12.8 says matching is a tab on the bill, "not a standalone list" — §12.8 wins, see below |
>
> **§12.8 vs §12.12 — a contradiction in this document.** §12.8 states that bill matching is reached from the supplier bill detail page and is explicitly *"not as a standalone list"*; §12.12's snippet lists a `/procurement/bill-matching` sidebar item. §12.8 describes the screen and §12.12 only summarises the navigation, so §12.8 was followed and the sidebar item was dropped.
>
> **§12.7 route.** `/procurement/grn` was used, not `/procurement/receipts` — §12.7 offers either and warns about the clash with Sprint 3's client receipts at `/receipts`.
>
> **§12.8's host page did not exist.** Sprint 4 shipped Supplier Bills nav-disabled on #26. Only `POST /bills` needs a supplier, so Sprint 5 built the list and detail read-only in order to have somewhere to put the Matching tab.

---

### 12.1 Where Procurement Lives in the Navigation

Procurement is a top-level sidebar group, same level as Finance. It is **not** inside a project workspace — it is organisation-wide.

```
Sidebar
├── Dashboard
├── Projects            ← existing
├── Finance             ← existing (Accounting)
├── Procurement         ← NEW (this sprint)
│   ├── Setup
│   │   ├── Units of Measure
│   │   ├── Material Categories
│   │   ├── Spend Categories
│   │   └── Materials
│   ├── Requests        ← Material Requests
│   ├── Orders          ← Purchase Orders
│   ├── Receipts        ← Goods Receipt Notes
│   ├── Bill Matching
│   └── Commitments     ← Commitment Ledger
├── Receipts            ← Sprint 3 client receipts (unchanged)
└── Settings
```

The Setup sub-group can be collapsed by default for non-admin users. Always show it for users with `manage:procurement-config`.

---

### 12.2 Permission Gating

| Permission | Controls |
|------------|---------|
| `view:procurement` | See any procurement page (minimum required) |
| `manage:procurement-config` | Create/deactivate UoM, Material Categories, Spend Categories, Materials |
| `create:material-request` | Create MR |
| `approve:material-request` | Approve MR (submit is available to the requester) |
| `create:purchase-order` | Create PO |
| `approve:purchase-order` | Approve PO (triggers commitment creation — gate this carefully) |
| `create:goods-receipt` | Create and post GRN |
| `approve:matching-exception` | Approve a bill matching exception |
| `view:commitment-ledger` | See the commitment ledger and summary |

Hide the sidebar group entirely if the user has no `view:procurement`. Show each sub-page only if the relevant permission is present. Never rely on frontend permission checks alone — the backend enforces them too; missing permissions return `403`.

---

### 12.3 Build Order

Build in this sequence. Each tier depends on the tier above being stable.

| Tier | What | Why first |
|------|------|-----------|
| **A — Master Data** | UoM, Material Categories, Spend Categories, Materials | All other screens need these lookups |
| **B — Material Requests** | MR list, create, detail, lifecycle | Prerequisite for PO allocation linking |
| **C — Purchase Orders** | PO list, create, detail, revision history | Drives commitments |
| **D — Goods Receipts** | GRN list, create, detail, post | COMMITTED→ACCRUED movement |
| **E — Bill Matching** | Match result view, exception approval | Posting gate on supplier bills |
| **F — Commitments** | Commitment ledger per project, summary widget | Read-only; can be built last |

---

### 12.4 Tier A — Master Data Setup Screens

All four screens follow the same pattern: a list table, a create drawer/dialog, and a deactivate action. No edit — deactivate and recreate.

#### Units of Measure

**List screen** (`/procurement/setup/uom`):
- Table: Code | Name | Symbol | Status
- Filter: status (ACTIVE / INACTIVE)
- Action: "New Unit of Measure" → create drawer
- Row action: Deactivate (confirm dialog) — only if no materials use this UoM

**Create drawer fields:**
| Field | Type | Notes |
|-------|------|-------|
| Code | Text | max 20 chars, uppercase recommended |
| Name | Text | English |
| Name (Arabic) | Text | optional RTL input |
| Symbol | Text | max 10 chars (e.g. `m³`, `t`) |

#### Material Categories

**List screen** (`/procurement/setup/material-categories`):
- Render as a **tree table** — root rows expand to show children (the API returns root categories with `children[]` nested)
- Columns: Code | Name | Status | Actions
- "New Category" button → create drawer (shows parent code picker for sub-categories)
- Deactivate cascades visually — warn user that deactivating a parent hides its children too

#### Spend Categories

**List screen** (`/procurement/setup/spend-categories`):
- Same tree table pattern as Material Categories
- Important UI note: always label this "Spend Category" — never "Cost Category" or "Material Category". They are different entities serving different purposes.

#### Materials

**List screen** (`/procurement/setup/materials`):
- Table: Code | Name | Base UoM | Material Category | Default Spend Category | Status
- Filters: `materialCategoryId`, `spendCategoryId`, status
- "New Material" button → create drawer
- Row action: Discontinue (status → `DISCONTINUED`)

**Create drawer fields:**
| Field | Type | Notes |
|-------|------|-------|
| Code | Text | max 50 chars |
| Name | Text | English |
| Name (Arabic) | Text | optional |
| Description | Textarea | optional |
| Material Category | Select (searchable) | fetched from `/procurement/material-categories` |
| Default Spend Category | Select (searchable) | fetched from `/procurement/spend-categories`, optional |
| Base Unit of Measure | Select | fetched from `/procurement/uom` — this cannot be changed after creation |

> **Warn the user on the Base UoM field:** "Once the material is created, the unit of measure cannot be changed. All purchase orders and goods receipts for this material will use this unit."

---

### 12.5 Tier B — Material Requests

#### MR List Screen (`/procurement/requests`)

- Table: MR Number | Scope | Project | Requested Date | Required By | Lines | Status
- Status badge: `DRAFT` (grey) | `SUBMITTED` (blue) | `APPROVED` (green) | `PARTIALLY_ORDERED` (amber) | `FULLY_ORDERED` (teal) | `CANCELLED` (red) | `CLOSED` (slate)
- Filters: status, scope (PROJECT / ORGANIZATION), projectId (searchable project picker)
- "New Material Request" → create page

#### MR Create Page

Two-step flow works best here given the line complexity.

**Step 1 — Header:**
| Field | Type | Notes |
|-------|------|-------|
| Scope | Radio: PROJECT / ORGANIZATION | |
| Project | Searchable select | required if scope = PROJECT, hidden if ORGANIZATION |
| Request Date | Date picker | defaults to today |
| Required By | Date picker | optional |
| Description | Text | |

**Step 2 — Lines (table editor):**
- Each row: Line Type | Material (if MATERIAL) | Description | UoM | Requested Qty | BOQ Node | Spend Category
- Line Type is `MATERIAL` / `SERVICE` / `OTHER`
- When `MATERIAL` is selected: show a **Material picker** (search by code or name). On selection, auto-fill Description from material name and lock UoM to the material's base UoM — the UoM field becomes read-only and shows "Locked to material base UoM".
- When `SERVICE` or `OTHER`: Description is free text, UoM is a normal select from active UoMs.
- BOQ Node and Spend Category are optional (contextual — most relevant for PROJECT scope lines).

**Line table column order:**
```
# | Type | Material | Description | UoM | Qty | BOQ Node | Spend Category | [delete]
```

#### MR Detail Page

- Header card: MR number, scope, project, status badge, requested/required dates, description
- Lines table: all line fields read-only
- Status timeline: show current status with history if available
- Action bar (based on status):

| Current Status | Actions available |
|----------------|------------------|
| `DRAFT` | Submit, Cancel |
| `SUBMITTED` | Approve (permission: `approve:material-request`), Cancel |
| `APPROVED` | Cancel, Close |
| `PARTIALLY_ORDERED` | Close |
| Any terminal | — |

- When `CANCELLED` or `CLOSED` — show read-only banner, no actions.

---

### 12.6 Tier C — Purchase Orders

#### PO List Screen (`/procurement/orders`)

- Table: PO Number | Supplier | Currency | Revision | Status | Effective From | Lines | Total Amount
- "Total Amount" = sum of `extendedAmount` on the ACTIVE revision's lines
- Status badge: `OPEN` (green) | `CLOSED` (slate) | `CANCELLED` (red)
- Filters: status, supplierId (supplier picker)
- "New Purchase Order" → create page

#### PO Create Page

Two-step flow:

**Step 1 — Header:**
| Field | Type | Notes |
|-------|------|-------|
| Supplier | Searchable select | from `/suppliers` |
| Currency | Select | active currencies |
| Effective From | Date picker | date this revision takes effect |
| Delivery Address | Text | |
| Expected Delivery | Date picker | optional |

**Step 2 — Lines (table editor):**
Same line editor pattern as MR, but adds:
- `Unit Price` column
- `Extended Amount` (auto-calculated = qty × price, display-only)
- `MR Line Allocations` — optional expandable per-line section where the user links this PO line to one or more approved MR lines with an allocated quantity

**MR Line allocation UI:**
- Small "Link to MR" button per PO line
- Opens a mini-picker: shows approved MRs (filtered to same project if project-scoped), select MR → select specific line → enter quantity
- Multiple allocations per PO line are supported
- Show the linked MR number + line number as a chip on the PO line row

#### PO Detail Page

- Header card: PO number, supplier, current status, current revision number
- **Revision tabs** at the top: show all revisions as numbered tabs (Rev 1, Rev 2 …). Active revision is pre-selected, SUPERSEDED shown in muted style.
- On each revision tab: show revision status, effective date, approval info, lines table
- Lines table (read-only for ACTIVE/SUPERSEDED): Code | Description | UoM | Qty | Unit Price | Extended | Spend Category
- **MR Allocations** panel below lines: shows which MR lines this PO line was allocated against (for traceability)

**Action bar (based on PO + revision status):**

| PO Status | Current revision status | Actions |
|-----------|------------------------|---------|
| OPEN | DRAFT | Submit revision, Cancel PO |
| OPEN | SUBMITTED | Approve (opens approval drawer), Cancel PO |
| OPEN | ACTIVE | Revise (create new DRAFT revision), Cancel PO |
| OPEN | EXCEPTION_PENDING | — (wait for GRN exception resolution) |
| CANCELLED / CLOSED | any | — |

**Approve drawer** (when approving a revision):
- Fields: Reporting Currency (pre-filled from org default), Exchange Rate (1.0 if same currency)
- Warning banner: "Approving this revision will create Commitment Ledger entries totalling [amount]. If a previous revision exists, its uncommitted balance will be reversed."
- Confirm button

**Revise drawer** (when creating a new revision):
- Same as create page Step 2 (lines editor) + required Reason field
- Pre-populate lines from current ACTIVE revision

---

### 12.7 Tier D — Goods Receipts

#### GRN List Screen (`/procurement/receipts`)

> Note: "Receipts" in this context means Goods Receipt Notes (procurement). The existing client payment receipts are in `/receipts` — use a distinct route like `/procurement/receipts` or `/procurement/grn` to avoid confusion.

- Table: GRN Number | PO Number | Supplier | Delivery Date | Delivery Note Ref | Status
- Status badge: `DRAFT` (grey) | `POSTED` (green) | `EXCEPTION_PENDING` (amber) | `CANCELLED` (red)
- Filter: `purchaseOrderId`
- "New Goods Receipt" → create page

#### GRN Create Page

**Step 1 — Header:**
| Field | Type | Notes |
|-------|------|-------|
| Purchase Order | Searchable select | shows only OPEN POs with ACTIVE revision |
| Delivery Date | Date picker | required |
| Delivery Note Ref | Text | optional (supplier's delivery note number) |

**Step 2 — Lines (auto-populated from PO):**
- On PO selection, pre-populate one GRN line per ACTIVE revision PO line
- Each row shows: Material/Description | Ordered Qty | Previously Received | Received Qty* | Accepted Qty* | Rejected Qty* | Rejection Reason | Quality Status
- Fields marked `*` are editable
- `Accepted + Rejected` must equal `Received` — show inline validation if not
- `Quality Status` select: `PENDING_INSPECTION` | `ACCEPTED` | `PARTIALLY_ACCEPTED` | `REJECTED`
- If total received per line would exceed PO ordered qty by >5%, show a warning banner: "This delivery exceeds the ordered quantity by more than 5%. The GRN will be saved with status EXCEPTION_PENDING and cannot be posted until the exception is resolved."

#### GRN Detail Page

- Header card: GRN number, PO number, supplier, delivery date, delivery note ref, status
- Lines table: all columns (ordered / previously received / received / accepted / rejected / quality)
- Exception banner if `status = EXCEPTION_PENDING`: amber callout explaining over-receipt, action is to either revise the PO or contact the supplier
- Action bar:

| Status | Actions |
|--------|---------|
| `DRAFT` | Post (opens post drawer), Cancel |
| `EXCEPTION_PENDING` | — (resolve via PO revision first) |
| `POSTED` | — (immutable) |
| `CANCELLED` | — |

**Post drawer:**
- Fields: Reporting Currency (pre-filled), Exchange Rate
- Summary of COMMITTED→ACCRUED movements that will be created
- Confirm button

---

### 12.8 Tier E — Bill Matching

Bill matching is accessed **from the Supplier Bill detail page**, not as a standalone list. Add a "Matching" tab to the existing Supplier Bill detail page (built in Sprint 4 AP module).

#### Matching Tab on Supplier Bill Detail

**Before matching is run** (`matchStatus: NOT_RUN`):
- Show an empty state panel: "Matching not yet run"
- "Run Matching" button (available if bill has a linked PO revision and is not yet POSTED)
- Explain the match type that will be used: "This bill contains material lines — Three-Way Matching will be applied (PO ↔ GRN ↔ Bill)."

**After matching is run:**
Show a match result table:

| PO Line | PO Qty | Received Qty | Billed Qty | PO Price | Billed Price | Qty Variance | Price Variance | Within Tolerance |
|---------|--------|-------------|------------|----------|--------------|--------------|----------------|-----------------|
| 12mm Rebar | 25 | 23 | 23 | 850.00 | 855.00 | 0 | +5.00 | ✓ |

- `Within Tolerance` column: green checkmark if true, red X if false
- Overall match status badge at the top of the tab

**Status-based UI on the Matching tab:**

| `matchStatus` | UI |
|---------------|----|
| `NOT_RUN` | Empty state + Run Matching button |
| `MATCHED` | Green banner "All lines matched within tolerance" |
| `MATCHED_WITH_TOLERANCE` | Amber banner "Matched with variance within tolerance" — Post button enabled on main tab |
| `EXCEPTION` | Red banner "Variance exceeds tolerance — posting blocked". Show Approve Exception button (requires `approve:matching-exception`) |
| `APPROVED_EXCEPTION` | Amber banner "Exception approved by [name] on [date]" — Post button enabled on main tab |

**Approve Exception drawer:**
- Text area: Approval Reason (required)
- Confirm button

#### Post Bill button (on the bill's main Actions tab)

The existing "Post" button from Sprint 4 must now check `matchStatus`:
- If `NOT_RUN` or `EXCEPTION`: disable the button and show tooltip: "Matching must pass before posting. Open the Matching tab."
- If `MATCHED`, `MATCHED_WITH_TOLERANCE`, or `APPROVED_EXCEPTION`: enable as normal.

---

### 12.9 Tier F — Commitment Ledger

#### Project Commitment Summary Widget

Add a **Commitments card** to the Project Command Center (alongside the existing KPI cards):

```
┌─────────────────────────────────────────────┐
│  Cost Commitments                           │
│                                             │
│  Committed   SAR 21,250                     │  ← PO approved, not yet received
│  Accrued     SAR 19,550                     │  ← Received, bill not yet posted
│  Actual      SAR 0                          │  ← Bill posted to GL
│                                             │
│  [View Commitment Ledger →]                 │
└─────────────────────────────────────────────┘
```

Data from `GET /procurement/commitment-ledger/projects/:projectId/summary`.

Fetch this on the Project Command Center page when `view:commitment-ledger` is present. If permission is absent, hide the card entirely.

#### Commitment Ledger Screen (`/procurement/commitments`)

- Header: project picker (required — there is no org-wide ledger view)
- Stage filter tabs: All | Committed | Accrued | Actual
- BOQ Node filter (optional — searchable BOQ node picker)
- Table: Date | Event Type | Stage | Amount | Currency | Spend Category | PO Number | BOQ Node | Source Doc

**Stage badge colours:**
- `COMMITTED` — blue (purchase order approved, goods not yet received)
- `ACCRUED` — amber (goods received and accepted, bill not yet posted)
- `ACTUAL` — green (bill posted to GL)

**Source doc link:** if `sourceDocumentType = PURCHASE_ORDER_REVISION`, show a link chip "PO-XXXXX" that navigates to the PO detail page. Similarly for `GOODS_RECEIPT`.

**Amount display:**
- Show `reportingAmount` in the org reporting currency
- Show `amount + currencyCode` in a secondary line if the PO currency differs from reporting currency

---

### 12.10 Common Procurement Component Patterns

**`<ProcurementStatusBadge status={...} />`**

Render a coloured badge for all procurement status values. Suggested colour map:

| Status | Colour |
|--------|--------|
| `DRAFT` | slate |
| `SUBMITTED` | blue |
| `APPROVED` | green |
| `ACTIVE` | green |
| `PARTIALLY_ORDERED` | amber |
| `FULLY_ORDERED` | teal |
| `POSTED` | green |
| `EXCEPTION_PENDING` | amber |
| `SUPERSEDED` | slate (muted) |
| `CANCELLED` | red |
| `CLOSED` | slate |
| `DISCONTINUED` | red |

**`<MaterialPicker onSelect={fn} />`**

- Search by code or name (debounced, calls `GET /procurement/materials?search=...`)
- Show code + name + base UoM symbol in the dropdown
- On selection, returns the full material object so the caller can lock the UoM

**`<UomDisplay uom={...} locked={boolean} />`**

- If `locked=true`, show the UoM symbol with a lock icon and tooltip "Locked to material base unit"
- If `locked=false`, render a normal select from active UoMs

**`<CommitmentStageTag stage={...} />`**

- Three distinct pill styles for `COMMITTED` (blue) / `ACCRUED` (amber) / `ACTUAL` (green)
- Include a small tooltip explaining what each stage means (for users unfamiliar with procurement accounting)

**`<QuantitySplit received accepted rejected />`**

Used on GRN lines to show the three-way quantity split visually:

```
Received: 24  [Accepted: 23 ░░░░░░░░░░░] [Rejected: 1 ▓]
```

---

### 12.11 Procurement Error States

| HTTP | Code | Screen | User-facing message |
|------|------|--------|---------------------|
| 400 | — | MR Create | "PROJECT-scoped requests require a project to be selected." |
| 400 | — | MR Create | "Material lines must have a material selected. The unit of measure is set automatically." |
| 400 | — | GRN Create | "Accepted + rejected quantity must equal received quantity on line [n]." |
| 409 | — | PO Approve | "Another ACTIVE revision exists — submit or cancel it before creating a new one." |
| 409 | — | GRN Post | "This goods receipt is [status] and cannot be posted." |
| 409 | — | GRN Create | "The purchase order has no ACTIVE revision to receive against." |
| 409 | — | Bill Post | "This bill cannot be posted — matching result is [matchStatus]. Open the Matching tab." |
| 404 | — | Any | "The requested record was not found. It may have been cancelled or deleted." |
| 403 | — | Any | "You do not have permission to perform this action." |

---

### 12.12 Procurement Navigation Update (Summary)

Add to the global sidebar `<PlatformSidebar>` component, after Finance and before Settings:

```tsx
{hasPermission('view:procurement') && (
  <SidebarGroup label="Procurement" icon={<ShoppingCartIcon />}>
    {hasPermission('manage:procurement-config') && (
      <SidebarGroup label="Setup" collapsible defaultCollapsed>
        <SidebarItem href="/procurement/setup/uom" label="Units of Measure" />
        <SidebarItem href="/procurement/setup/material-categories" label="Material Categories" />
        <SidebarItem href="/procurement/setup/spend-categories" label="Spend Categories" />
        <SidebarItem href="/procurement/setup/materials" label="Materials" />
      </SidebarGroup>
    )}
    <SidebarItem href="/procurement/requests" label="Requests" />
    <SidebarItem href="/procurement/orders" label="Orders" />
    <SidebarItem href="/procurement/grn" label="Receipts" />
    <SidebarItem href="/procurement/bill-matching" label="Bill Matching" />
    {hasPermission('view:commitment-ledger') && (
      <SidebarItem href="/procurement/commitments" label="Commitments" />
    )}
  </SidebarGroup>
)}
```

Also update the **Supplier Bill detail page** (existing Sprint 4 component) to:
1. Add a "Matching" tab to the tab bar
2. Gate the "Post" button on `matchStatus` — see section 12.8
