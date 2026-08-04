# Rukna ERP — Frontend Design Plan

Version: 1.0.0
Last Updated: 2026-08-04
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
