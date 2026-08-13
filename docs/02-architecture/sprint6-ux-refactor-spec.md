# Sprint 6 — UX & Information Architecture Refactor
# Spec v1.0 — LOCKED

Status: **LOCKED — implement against this document**  
Grilled by: Abdulsalam (lead engineer / architecture owner)  
Frontend owner: Abdimalik (frontend engineer)  
Date: 2026-08-12

---

## Statement of Intent

The sidebar and global navigation are already strong. This sprint refactors the **inside** of the product — client creation, project creation, and the project workspace — so that the construction workflow is obvious to a new employee and every screen they land on is usable without explanation.

The guiding principle is unchanged: **the Project is the primary context.** The change is making that principle felt inside every tab, form, and detail page, not just in the sidebar structure.

---

## 1. What Changes

### What this sprint improves
- Client creation form → final approved field set, correct navigation after create
- Client details page → tabbed, with Overview / Projects / Financials / Documents / Activity
- Project creation form → final approved field set, correct navigation after create, client preselection from client context
- Project workspace shell → extended to accommodate the full 11-tab target IA
- Project Overview → command-center pattern, setup progress in DRAFT, operational health in ACTIVE
- Team tab → clarified from "Members" to "Team"
- BOQ tab → refined layout and hierarchy display
- Contract tab → improved layout; main vs. subcontract distinction when backend lands
- Project IPC workspace → new `/projects/[id]/ipc` route (gated on B-IPC-01)
- Responsive behavior → mobile dropdown on narrow viewports, horizontal scroll on desktop
- Accessibility → visible focus states, keyboard navigation, ARIA labels

### What this sprint does NOT change
- BOQ calculations, BOQ locking rules
- IPC freezing, IPA immutability after SUBMITTED
- Project lifecycle transitions, approval thresholds
- Commitment logic, inventory ledger behavior, accounting posting
- Project membership / security rules
- Anything in `apps/api/**`

---

## 2. Critical Implementation Rule

```
Build the final UI structure now.
Gate only data behavior that genuinely requires missing backend support.
Never fake persistence or expose unsupported functionality as live.
```

Form layouts, component shells, and tab architecture can be implemented before backend integration is complete. Production functionality must not pretend to work when backend support is absent.

**Specifically prohibited:**
- Collecting contact fields in the client form and silently discarding them on submit
- Rendering an IPC tab and showing a loading spinner or empty state when the API doesn't exist yet
- Showing Finance metrics as zero/null cards when no aggregation endpoint exists

**Acceptable pattern:**
- Build the client form with contact fields to their final shape. Contact persistence is gated on B-CLIENT-01. Until it lands, the branch that wires contact data is feature-flagged or the ticket is declared dependent.
- Build the Contract tab layout now. The main vs. subcontract distinction is added when B-CONTRACT-01 lands.
- Prepare IPC workspace component architecture. The tab is not exposed as live until B-IPC-01 lands.

---

## 3. Navigation Architecture

### 3.1 Project Workspace Tab Set

**Target IA (11 tabs — the full architecture):**
```
Overview · Contract · BOQ · Team · Procurement · Inventory · Progress · IPC · Finance · Documents · Activity
```

**Currently enabled (this sprint):**
```
Overview · Contract · BOQ · Team
```

**Next candidate (gated on B-IPC-01):**
```
IPC
```

**Withheld until backend ships:**
```
Procurement  — needs reliable project-scoped filter
Inventory    — Sprint 7
Progress     — Sprint 9
Finance      — needs aggregation endpoint
Documents    — needs file serving endpoint
Activity     — needs audit API surfaced
```

**Shell design rule:** Build `ProjectWorkspaceShell` to accommodate all 11 tabs without a future redesign. Only render tabs that have live backend coverage. Do not render disabled placeholders.

### 3.2 Responsive Project Navigation

**Large screens (≥ md):** Horizontal tab strip.
- Single row, no wrapping
- Horizontal scroll if constrained
- Active tab: `border-brand-primary text-brand-primary`
- Keyboard/focus accessible

**Small screens (< md):** Replace tab strip with a native `<select>` dropdown showing current location.

Groupings in the dropdown (for future reference when more tabs are added):
```
PROJECT
  Overview, Contract, BOQ, Team

EXECUTION
  Procurement, Inventory, Progress

COMMERCIAL
  IPC, Finance

RECORDS
  Documents, Activity
```

### 3.3 Global Sidebar

The primary sidebar currently has: Dashboard, Projects (Clients, Projects), Accounting, Procurement, Administration.

This sprint does not restructure the sidebar domains. Contracts remain accessible via the project workspace. Global `/contracts` route is preserved and not deleted — it may be surfaced under a Commercial sidebar domain in a later sprint.

---

## 4. Client Workflow

### 4.1 Client Creation Form

**Approved field set (locked):**

```
Basic Information
  Client Name *
  Client Type  (COMPANY | GOVERNMENT | NGO | INDIVIDUAL | OTHER)

Contact
  Contact Person
  Phone
  Email

Address

Business Information
  Tax / Registration Number
  Default Currency

Additional
  Notes
```

**System-controlled (not in form):**
- Client Code → server-generated (format CLI-000001 or existing backend format)
- Status → ACTIVE by default

**Removed:**
- Arabic client name
- Payment terms
- Manually required client code

**Contact persistence (B-CLIENT-01 dependency):**

The current `POST /clients` does not accept contact data atomically. The existing `POST /clients/:id/contacts` is a separate sub-resource call.

Backend ticket B-CLIENT-01 adds optional `primaryContact` to `POST /clients` and persists atomically in one transaction.

Frontend behaviour before B-CLIENT-01 lands:
- Contact fields are rendered in the form to their final approved shape
- The frontend ticket that wires contact persistence is declared dependent on B-CLIENT-01
- Submission MUST NOT silently discard contact fields
- Do not ship until B-CLIENT-01 is merged, OR gate the contact sub-section with a clear developer-only note that prevents silent data loss

### 4.2 Post-Creation Navigation

After creating a client: navigate directly to the client details page. Do not return to the client list.

### 4.3 Client Details Page

**Header:** Client Name · Client Code · Status badge

**Tabs:**
```
Overview · Projects · Financials · Documents · Activity
```

No Contracts tab at client level. Contracts belong to projects.

**Overview contains:**
- Client type
- Main contact (name, phone, email)
- Address
- Tax / registration number
- Default currency
- Project summary (count of projects by status)

**Primary action:** `+ New Project` (navigates to project creation form with clientId preselected)

**Financials, Documents, Activity tabs:** Render their shells in this sprint. Full data population may follow when backend capabilities exist. Do not fabricate metrics.

---

## 5. Project Workflow

### 5.1 Project Creation Form

**Approved field set (locked):**

```
Identity
  Project Name *
  Project Code  (prefer server-suggested; allow editing before create; immutable after creation per existing business rule)
  Client *      (auto-populated when entering from Client → New Project; manual selection from Projects → New Project)

Location

Schedule
  Start Date
  Expected Completion

Additional
  Description
```

**Project Manager is NOT in this form.** It comes from project membership via the Team tab.

```
Create Project → Project Overview → Team → Add Project Manager
```

Atomic project + initial membership creation is not in scope for this sprint.

**Removed from form:**
- Arabic project name
- Contract Value
- Contract Currency

Do not reintroduce these fields. Contract value belongs to the Contract domain.

### 5.2 Client → New Project Flow

When a user clicks `+ New Project` on a client details page:
- clientId is passed as a URL param or query string
- The project creation form pre-populates and locks the Client field
- The same form component handles both entry points — no duplicate forms

### 5.3 Post-Creation Navigation

After creating a project: navigate directly to Project Overview. Do not return to the project list.

### 5.4 Project Header

```
[Back to Projects]

{Project Code}  {Status Badge}                    {lifecycle actions}
{Project Name}
{Client Name} · {Location}

[── lifecycle strip ──────────────────────────────────]

Overview | Contract | BOQ | Team
```

**Lifecycle actions:** Status-aware. Show only valid transitions for current status. Destructive actions (Cancel, Suspend) live in an overflow `⋮` Actions menu, not as persistent red buttons.

Valid actions by status:
- DRAFT: Edit, Approve Project, (overflow: Cancel)
- APPROVED: Start Mobilization, (overflow: Cancel)
- MOBILIZING: Start Project, (overflow: Suspend, Cancel)
- ACTIVE: Mark Practical Completion, (overflow: Suspend)
- SUSPENDED: Resume
- CLOSEOUT: Close Project

---

## 6. Project Workspace Tabs

### 6.1 Overview

**During DRAFT — emphasise setup progress:**

```
PROJECT SETUP
✓ Project created
○ Main contract
○ BOQ
○ Project team
```

Contextual next-step actions: Create Contract, Add BOQ, Add Team Members.
Not a wizard — users may navigate freely.

**During ACTIVE — emphasise operational health:**

Show available authoritative metrics only:
- Contract Value (from Contract domain)
- Certified Revenue (from effective/approved IPCs)
- Received (from receipts if reliably scoped)

Do not fabricate Budget, Forecast, Margin, Committed without authoritative backend definitions.
Use clean empty states rather than zero/null cards for unavailable metrics.

### 6.2 Contract Tab

**Navigation label:** Contract (singular)  
**Route:** `/projects/[id]/contracts` (preserved — no churn)

**Empty state:** "No main contract yet — [ Create Main Contract ]"

**Main contract (CLIENT_CONTRACT) section:**
- Contract number, contract date, original contract value, currency
- Start date, completion date
- Retention %, advance amount/%, defects liability period
- Client representative, notes
- Documents (when file serving exists)

**Subcontracts section:** Secondary, below main contract.

**B-CONTRACT-01 dependency:** The main vs. subcontract distinction requires the `type` discriminator field on Contract. Contract tab layout and field improvements can be implemented now. Final main/sub presentation is gated on B-CONTRACT-01.

**Invariant (for B-CONTRACT-01 ticket):** At most one current/effective primary CLIENT_CONTRACT per project. "Effective" rather than "ACTIVE" to avoid collision with Contract's own status lifecycle. Variations/change orders belong under the main CLIENT_CONTRACT as sub-records, not as separate CLIENT_CONTRACT entities.

### 6.3 BOQ Tab

Preserve existing hierarchical BOQ model. Improve layout and hierarchy display.

Status strip: DRAFT → BASELINED → LOCKED

Actions: Import BOQ · Add Section · Add Item

Tree/table visualization readable at 3–4 levels. Preserve all existing BOQ calculations and backend hierarchy behavior.

### 6.4 Team Tab

Rename "Members" to "Team" everywhere in this tab.

Show:
- Project Manager (promoted display)
- Project members with role
- Active/removed state where relevant

Actions: Add Member, Change Role, Remove

Preserve all project membership authorization rules.

### 6.5 IPC Workspace Tab (gated on B-IPC-01)

**Route:** `/projects/[id]/ipc`

**Tab is NOT exposed as live until B-IPC-01 is merged.**

When live, the tab shows:
- List of IPAs/IPCs for this project (all contracts)
- IPC Number, Status, Period, Certified Amount
- Primary action: New Application
- Each entry links to canonical detail at `/contracts/[id]/applications/[ipaId]/certificates/[ipcId]`

Component architecture and route shell can be prepared in advance of B-IPC-01. Do not expose the tab.

---

## 7. Backend Prerequisite Tickets

These must be created as GitHub issues and the corresponding frontend tickets must declare a `depends on` relationship.

### B-IPC-01 — Add `?projectId=` filter to GET /ipa

**What:** Add `projectId` as a supported query parameter on `GET /ipa`.  
**Backend behavior:** Resolve project → contracts → IPAs server-side; enforce project-level authorization centrally.  
**Preserve:** Existing `?contractId=` filter must continue to work.  
**Why:** Frontend never does N+1 traversal across a project's contracts to build the IPC workspace list.  
**Blocks:** Frontend ticket F-11 (Project IPC workspace)

### B-CLIENT-01 — Atomic primary contact on POST /clients

**What:** Add optional `primaryContact` object to `CreateClientDto`. Persist client + contact in one transaction.  
**Preserve:** Existing `POST /clients/:id/contacts` for subsequent contact management (add more contacts, etc.)  
**Why:** Contact failure must not leave a client record with no contact and no error visible to the user.  
**Blocks:** Frontend ticket F-09 (contact-on-create integration)

### B-CONTRACT-01 — Contract type discriminator

**What:** Add explicit `type` field to Contract entity (`CLIENT_CONTRACT | SUBCONTRACT` or per repository naming conventions). Enforce the invariant: at most one current/effective CLIENT_CONTRACT per project at a time.  
**Critical distinction:** The invariant is "current/effective," not "ACTIVE" — avoid collision with Contract's own status lifecycle terminology.  
**Variations/change orders:** Belong under the main CLIENT_CONTRACT as sub-records; they are NOT separate CLIENT_CONTRACT entities.  
**Blocks:** Frontend ticket F-10 (main/subcontract distinction in Contract tab)

---

## 8. Routes Map

### Currently live
```
/clients                                              client list
/clients/new                                          create client (improving this sprint)
/clients/[id]                                         client details (building this sprint)
/clients/[id]/edit                                    edit client

/projects                                             project list
/projects/new                                         create project (improving this sprint)
/projects/[id]                                        project overview (improving this sprint)
/projects/[id]/edit                                   edit project
/projects/[id]/contracts                              contract tab (improving this sprint)
/projects/[id]/boq                                    BOQ tab (improving this sprint)
/projects/[id]/members                                team tab (renaming to "Team")

/contracts/[id]                                       contract detail (global, preserved)
/contracts/[id]/applications/[ipaId]                  IPA detail (canonical, untouched)
/contracts/[id]/applications/[ipaId]/certificates/[ipcId]   IPC detail (canonical, untouched)
```

### New routes this sprint
```
/projects/[id]/ipc                                    project IPC workspace (gated on B-IPC-01)
```

### Preserved (not deleted)
```
/contracts                                            global cross-project contracts list
```

---

## 9. Reusable Components

Reuse before creating new:

| Component | Location | Notes |
|---|---|---|
| `ProjectWorkspaceShell` | `components/layout/project-workspace-shell.tsx` | Extend tab list, do not rebuild |
| `ProjectStatusBadge` | `features/projects/components/project-status-badge.tsx` | Reuse |
| `LifecycleStrip` | inside shell | Preserve |
| `platform-data-grid` | `components/platform-data-grid.tsx` | Reuse for lists |
| `confirm-action-dialog` | `components/confirm-action-dialog.tsx` | Reuse for destructive actions |
| `status-badge` | `components/status-badge.tsx` | Reuse |
| `page-header` | `components/layout/page-header.tsx` | Reuse/extend |
| `kpi-card` | `components/widget/kpi-card.tsx` | Use for Overview metrics |

Extract new shared components only when a pattern is genuinely reused across ≥ 2 features:
- `EmptyState` — consistent empty-state pattern
- `ActionMenu` — overflow menu for lifecycle actions
- `FormSection` — grouped form fields with label

---

## 10. Engineering Constraints (unchanged)

- Next.js App Router — Server Components by default, `'use client'` only when state/browser APIs needed
- TanStack Query for all server state
- All API calls through `src/lib/api-client.ts`
- next-intl for every user-visible string — no hardcoded English
- Bilingual (en + ar RTL) — test both locales
- Mobile-first — 375px viewport must work; touch targets ≥ 44×44px
- Tailwind CSS only — use `packages/ui/` before creating components
- Domain constraints (BOQ locking, IPC freezing, approval thresholds, etc.) are NOT frontend concerns — do not replicate them in UI logic unless explicitly guarding a known UX pitfall documented in CLAUDE.md

---

## 11. Verification Checklist

After implementation, verify this journey manually:

```
Dashboard
→ Clients
→ New Client (final form, all fields)
→ Create → Client Details (not list)
→ + New Project (clientId preselected)
→ Create → Project Overview (not list)
→ Contract tab
→ BOQ tab
→ Team tab (label: Team, not Members)
→ Lifecycle action (Approve Project)
→ Responsive: narrow viewport → dropdown navigation works
→ Responsive: wide viewport → horizontal tab strip, single row
```

Also run:
```
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Report pre-existing failures separately from failures introduced by this sprint.
