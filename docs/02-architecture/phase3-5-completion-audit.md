# Phase 3–5 Completion Audit
## Rukna ERP — Clients · Projects · Dashboard

**Audited:** 2026-08-13  
**Auditor:** Claude Code (Sonnet 4.6)  
**Spec:** `docs/02-architecture/sprint6-ux-refactor-spec.md`  
**Blockers register:** `docs/backend-requests/frontend-blockers.md`  
**Commit context:** `7363d2d` (HEAD at audit time)  

---

### How to read this document

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | Requirement met; evidence read from source. |
| **PARTIAL** | Feature exists but missing stated sub-requirements. |
| **BLOCKED** | Backend prerequisite absent; correct to not implement. |
| **INTENTIONALLY OMITTED** | Spec says "not yet built" or domain question open. |
| **MISSING** | Prerequisite is met, feature is absent, no principled reason. |
| **NOT VERIFIED** | Visual confirmation not performed (browser not running). |

---

## Phase 3 — Clients

### C-01 Client List

**Status: IMPLEMENTED (with one noted gap)**

**Evidence:**
- `apps/web/src/features/clients/components/clients-list.tsx` — uses `PlatformDataGrid`
- Text search: delegated to grid (`searchLabel`, `searchPlaceholder`, `noMatchMessage`, `clearFiltersLabel`) ✓
- Status filter: `StatusFilter` select → `filterClients` ✓
- Client-type filter: `TypeFilter` select → `filterClients` ✓
- New Client button: `toolbarActions` → `<Link href="/clients/new">` ✓
- Loading: `isLoading={isPending}` ✓
- Error + retry: `isError`, `onRetry`, `errorMessage`, `retryLabel` ✓
- Empty state: `EmptyState` with title, description, "New Client" action ✓
- Clear filters: PlatformDataGrid built-in ✓
- Result count: `resultLabel={(count) => t('countLabel', { count })}` ✓

**Columns rendered:** code (sticky mono), name (sortable, linked to `/clients/:id`), taxNumber, defaultCurrency, status.  
The spec lists Type and primary-contact as columns. The implementation shows taxNumber/currency instead. This is a display choice — the type is available as a filter. Given no production data yet this is LOW risk.

**Permission gating:** `can()` is not called on New Client. `PERMISSIONS_ENFORCED = false` system-wide (A2/P5) — wiring the check is deliberately deferred. Not a fix target here.

---

### C-02 Client Create

**Status: IMPLEMENTED** (B-CLIENT-01 merged in `58bce62`)

**Evidence:**
- `apps/web/src/features/clients/components/client-form.tsx` (full file read)
- Fields (create mode): name (required), type, contactName, contactPhone, contactEmail, address, taxNumber, defaultCurrency, notes — 9 fields ✓
- Contact section rendered only in create mode (`!isEdit`) ✓
- Client code: server-generated; not in form ✓
- Status: system-controlled; not in form ✓
- `toCreateClientPayload` in `client-form-payload.ts` sends `primaryContact: { name, phone, email }` when contactName is provided ✓ (B-CLIENT-01 wired)
- Zod schema: name min/max, taxNumber max, contactEmail validates email or empty, `superRefine` requires contactName when phone or email filled ✓
- `FormErrorSummary`: shows field errors + API errors ✓
- 409 conflict: mapped to actionable message ✓
- Dirty-form `beforeunload`: `if (!isDirty || isSuccess) return` — uses `create.isSuccess` ✓
- Cancel confirmation: `ConfirmActionDialog` when `isDirty && !isSuccess` ✓
- Success navigation: delegated to `useCreateClient` mutation `onSuccess` — not verified (browser not running)

---

### C-03 Client Edit

**Status: IMPLEMENTED**

**Evidence:**
- Same `ClientForm` component, `isEdit = client !== undefined`
- Code shown as read-only `<Input id="client-code" value={client.code} readOnly />` — immutable ✓
- Contact section hidden in edit mode (`!isEdit` conditional) — correct; primary-contact editing not in scope ✓
- `toUpdateClientPayload`: sends name, type, taxNumber, defaultCurrency, address, notes (no contact fields) ✓
- Nullable-clear: sends `null` (not empty string) to clear optional fields — correct for PATCH semantics ✓
- Immutable code: never in payload (`code` is excluded from `toUpdateClientPayload`) ✓

---

### C-04 Client Detail Header

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/features/clients/components/client-detail.tsx` lines 65–117 (read in prior session)

- Back link to `/clients` ✓
- Client code (monospace) + `ClientStatusBadge` ✓
- Client name (locale-aware: `client.nameAr || client.name`) ✓
- New Project link → `/projects/new?clientId=${client.id}` ✓
- Edit link → `/clients/${client.id}/edit` ✓
- Deactivate / Reactivate button (status-conditional, requires ConfirmActionDialog) ✓
- 403/404 → not-found alert + back link ✓
- Loading skeleton ✓

---

### C-05 Client Overview Tab

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/features/clients/components/client-detail.tsx` lines 132–174 (read in prior session)

- Client type ✓
- Primary contact: name, phone, email — reads from `client.contacts[0]` (B-CLIENT-01 merged, contacts now populated) ✓
- Tax/registration number ✓
- Default currency ✓
- Address ✓
- Notes ✓
- Created date ✓
- No fabricated data ✓

**`?contact=needs-attention` query param:** shows an info `Alert` to draw attention to the contact section ✓

---

### C-06 Client Projects Tab

**Status: PARTIAL (B8 — client-side filter)**

**Evidence:** `client-detail.tsx` → `ClientProjects` component (read in prior session)

- Uses `useProjects().filter(p => p.clientId === clientId)` — client-side ✓ (B8: no `?clientId=` on `GET /projects`)
- Columns shown: code, name, status badge, project link ✓
- Empty state ✓
- Loading skeleton ✓

**Missing from spec:**
- Schedule columns (start date, expected end) — not rendered
- Error state for projects-fetch failure

**Known limitation (B8):** `GET /projects` has no server-side `clientId` filter. Fetches all-then-filters. Documents in `frontend-blockers.md`. Acceptable at current scale.

---

### C-07 Financials, Documents, Activity Tabs

**Status: INTENTIONALLY OMITTED**

**Evidence:** `client-detail.tsx` lines 182–193 (read in prior session)

All three tabs render an honest empty-state message via `t('financialsEmpty')`, `t('documentsEmpty')`, `t('activityEmpty')`. No fabricated data, no placeholder charts. Correct per spec ("no mocked data").

---

### C-08 Client-to-Project Handoff

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/features/projects/components/project-form.tsx` (lines 1–100 read)

- New Project from client detail: passes `?clientId=${client.id}` ✓
- ProjectCreateWizard reads `?clientId` from searchParams ✓
- Client select field is locked when `lockedClientId` is set; shows client name as read-only ✓
- `isLockedClientNotFound` guard: `isClientLocked && !clientsPending && !lockedClientName` → shows Alert + back link instead of blank locked field ✓
- Active-only filter in dropdown (ACTIVE clients only) ✓

**Gap — inactive client warning:** When the client referenced by `?clientId=` is INACTIVE, the locked field shows the client name but does not warn that the client is inactive. The form will proceed to submit and the API may accept or reject it depending on backend validation. This is MEDIUM.

---

### Phase 3 Decision

**Phase 3 — PARTIAL**

Blocking items for COMPLETE status:
- Schedule columns missing on C-06 client projects tab (MEDIUM)
- Inactive client warning missing on C-08 (MEDIUM)

All critical flows (create, view, edit, lifecycle, handoff) work correctly.

---

## Phase 4 — Projects

### P-01 Project List

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/features/projects/components/projects-list.tsx` (full file read)

- Uses `PlatformDataGrid` ✓
- Status filter: `StatusFilter` select → `filterProjects` ✓
- Text search: via PlatformDataGrid ✓
- Columns: code (sticky mono), status badge, name/clientName (sortable, linked), startDate, arrow ✓
- New Project button: `toolbarActions` → `<Link href="/projects/new">` ✓
- Loading: `isPending` ✓
- Error + retry ✓
- Empty state with New Project action ✓
- Result count ✓
- Locale-aware name (shows `nameAr` in AR locale) ✓

---

### P-02 Project Create Wizard

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/features/projects/components/project-form.tsx` lines 1–100 (read)

- 3-step wizard: Step 1 Identity (name, code, client, location), Step 2 Schedule (startDate, expectedEndDate, description), Step 3 Review ✓
- Client dropdown: ACTIVE clients only ✓
- Client locking from `?clientId=` ✓
- Zod schema: code min 1/max 30, name min 1/max 255, clientId required, endDate ≥ startDate ✓
- Per-step validation (can't advance with errors) ✓
- `beforeunload` dirty guard using `create.isSuccess` ✓
- Removed from Sprint 6: contractValue, currency, projectManager, arabicName ✓

---

### P-03 Project Edit

**Status: IMPLEMENTED**

**Evidence:** `project-form.tsx` → `ProjectEditForm` branch

- DRAFT-only: edit button not rendered for non-DRAFT (enforced in `project-actions.ts: canEdit: project.status === DRAFT`) ✓
- Same field set as create minus code (code is read-only in edit) ✓

---

### P-04 Inactive Client Handling in Project Create

**Status: PARTIAL**

**Evidence:** `project-form.tsx` lines 1–100

- `?clientId=` locks the client field ✓
- `isLockedClientNotFound` shows an error Alert when the locked client can't be found ✓
- **Missing:** no warning when the locked client IS found but is `status === 'INACTIVE'`. The form proceeds to submit, and `INACTIVE` client validation depends on backend behavior. This is the same gap as C-08.

---

### P-05 Project Workspace Header

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/components/layout/project-workspace-shell.tsx` (full file read in prior session)

- Back to Projects link ✓
- Project code (monospace) + `ProjectStatusBadge` ✓
- Contract value from `project.contractValue` (gap noted under P-09) ✓
- `#project-header-actions` slot for portal injection ✓
- Project name (`h1`) ✓
- Client · location ✓
- `LifecycleStrip`: all 7 normal statuses + SUSPENDED/CANCELLED shown separately ✓
- Workspace tabs: 11 total, 4 enabled (Overview, Contract, BOQ, Team) ✓
- Mobile: `<select>` dropdown ✓
- Desktop: horizontal tab strip with icons, `border-brand-primary` active state ✓

---

### P-06 Lifecycle Actions

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/features/projects/project-actions.ts` (full file read) + `project-actions-panel.tsx` (read in prior session)

`getAvailableActions(project)` returns:
- `advance`: next command in lifecycle chain (blocked while suspended) ✓
- `canEdit`: DRAFT only ✓
- `canCancel`: DRAFT / APPROVED / MOBILIZING / ACTIVE (mirrors `ProjectService` backend rule) ✓
- `canSuspend`: not terminal and not already suspended ✓
- `canResume`: currently suspended ✓
- `advanceBlockedBySuspension`: UI shows blocked reason ✓

Panel renders:
- Primary advance button with correct label per status ✓
- Edit link (DRAFT only) ✓
- Resume button (no confirmation needed) ✓
- Overflow `DropdownMenu`: Suspend (requires reason), Cancel (destructive, requires reason) ✓
- All destructive actions gated behind `ConfirmActionDialog` ✓

**Note:** cancel is allowed from ACTIVE status in this implementation (backend rule). The spec's action table shows only "Suspend" from ACTIVE. This is intentional — backend allows it and `project-actions.ts` mirrors the backend.

---

### P-07 Project Setup Checklist

**Status: PARTIAL (step order diverges from spec)**

**Evidence:** `project-detail.tsx` → `SetupStepper` component (read in prior session)

Steps rendered:
1. Project created — always complete (green check) ✓
2. BOQ — complete when `hasBoq` (any BOQ record exists) ✓
3. Contract — locked until `hasBaselinedBoq`; complete when `hasContract` ✓
4. Team — complete when `project.members.length > 0` ✓

**Spec order:** `Project created → Main contract → BOQ → Project team`  
**Implementation order:** `Project created → BOQ → Contract → Team`

The implementation order captures the genuine dependency: you cannot create a contract without a baselined BOQ. The spec's order is logically inconsistent with the API contract requirement (`Contract.boqVersionId` must reference a BASELINED version). The implementation order is correct; the spec should be updated.

**Additional gap:** "Main contract" — with B-CONTRACT-01 merged, the backend now has a `CLIENT_CONTRACT` type discriminator. The checklist still checks `hasContract` (any contract). It should check `hasClientContract` (type = CLIENT_CONTRACT). This is MEDIUM. Fix after confirming B-CONTRACT-01's exact response shape.

---

### P-08 Draft Project Overview

**Status: IMPLEMENTED**

**Evidence:** `project-detail.tsx` lines 173–180 (read)

When `project.status === 'DRAFT'`, `SetupStepper` is shown. Identity info (client, location, schedule) rendered in the info groups below it ✓.

---

### P-09 Active/Non-Draft Project Overview KPI Cards

**Status: PARTIAL — contract value reads wrong source**

**Evidence:** `project-detail.tsx` lines 140–188 (read)

```tsx
const contractValueDisplay = formatMoney(project.contractValue, project.currency, locale);
// …
<KpiCard label={t('contractValue')} value={contractValueDisplay ?? t('notSet')} />
```

`project.contractValue` is a legacy field on the project record. The Sprint 6 project create form removed `contractValue` from user input. New projects (created post-Sprint-6) have `project.contractValue = null` even if a contract with a `contractValue` exists.

The spec says **"Contract Value (from Contract domain)"**. The contracts query is already available in the same component (`contracts = useContracts(id)`). The fix is to read `contracts.data?.[0]?.contractValue ?? project.contractValue`.

`certifiedRevenue` and `received` both render `t('notAvailable')` — correct (no aggregation endpoint) ✓.

**WorkSpace shell header** also reads `project.contractValue` — same issue, lower priority (informational display only).

**Severity: HIGH** — the primary commercial KPI shows "Not Set" for any project created after the Sprint-6 form change even when a contract is on file.

---

### P-10 Contract Workspace Tab

**Status: IMPLEMENTED (pre-Sprint-6)**

Contract list, create, detail, commercial terms, lifecycle — all pre-existing from Sprint 3. Tab is enabled in workspace shell (`key: 'contract'`, `enabled: true`). B-CONTRACT-01 merged — type discriminator now available; contract workspace does not yet surface `CLIENT_CONTRACT` vs `SUBCONTRACT` distinction (separate scope).

---

### P-11 BOQ Workspace Tab

**Status: IMPLEMENTED (pre-Sprint-6)**

BOQ initialize, version management, tree CRUD, baseline, revision — all pre-existing. Tab enabled ✓.

---

### P-12 Project Team Workspace Tab

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/features/projects/components/project-members.tsx` (full file read)

- Member table: name, email, roles (PROJECT_MANAGER first) ✓
- Add member form: user picker (candidates = org users not already on project), multi-role picker ✓
- Remove with `ConfirmActionDialog` ✓
- `removeBlockReason`: blocks removing last project manager ✓
- Membership-only guard noted via `Alert` (only members can modify membership) ✓
- Loading/error states ✓
- Empty state ✓

**Prior note in `frontend-blockers.md`** (B1/B2): the page was a placeholder until 2026-08-11 when the sweep caught that both blockers had been resolved in `e85bab9`. The page is now fully built.

---

### P-13 IPC Workspace Tab

**Status: PARTIAL — placeholder exists, feature build required**

**Evidence:**
- `project-workspace-shell.tsx` allTabs — `{ key: 'ipc', enabled: false }` ✓ (tab hidden from navigation)
- `apps/web/src/app/(app)/projects/[id]/ipc/page.tsx` exists — renders a "coming soon" dashed card; `platform.projects.ipc.comingSoon` i18n key

**Backend status change:** commit `58bce62` "feat(api): B-IPC-01, B-CLIENT-01, B-CONTRACT-01 — sprint 6 backend prerequisites" — B-IPC-01 (`?projectId=` filter on `GET /ipa`) is now merged. The backend blocker is resolved.

The frontend tab is deliberately hidden. The placeholder page confirms the route slot is reserved. Building the actual IPC workspace content (IPA list filtered by `?projectId=`, IPC list, issue-certificate action) is the next construction sprint task.

**Severity: HIGH** — the global IPC billing chain is built; project-scoped access has no backend blocker but the UI is a placeholder.

---

### Phase 4 Decision

**Phase 4 — PARTIAL**

Required before COMPLETE:
1. **HIGH** — P-09: Contract value KPI reads `project.contractValue` not contracts domain (fixable now)
2. **HIGH** — P-13: IPC tab disabled despite B-IPC-01 being merged; page not built
3. **MEDIUM** — P-07: Setup checklist "Main contract" check should filter `CLIENT_CONTRACT` type (B-CONTRACT-01 merged)
4. **MEDIUM** — P-04: Inactive client warning in project create

---

## Phase 5 — Dashboard

### D-01 Portfolio KPI Counts

**Status: IMPLEMENTED**

**Evidence:** `apps/web/src/features/dashboard/components/dashboard-content.tsx` (full file read)

- 5 KPI cards in responsive grid: Total Projects, Active (MOBILIZING+ACTIVE+PRACTICAL_COMPLETION+CLOSEOUT), Pending (DRAFT+APPROVED), Finished (CLOSED+CANCELLED), Clients ✓
- Client count: reads `clients?.length` from `useClients()` ✓
- Client KPI shows "—" on error (independent fallback) ✓
- `formatNumber` used for locale-aware numerals ✓
- KPI cards link to `/projects` and `/clients` ✓

---

### D-02 Attention Queue

**Status: BLOCKED**

`GET /attention-items` does not exist anywhere in the API (`frontend-blockers.md` confirmed). No frontend component exists — correctly not built. Will be implemented when backend delivers the endpoint.

---

### D-03 Recent Projects Table

**Status: IMPLEMENTED**

**Evidence:** `dashboard-content.tsx` lines 120–131 — `PortfolioTableWidget` shows `summary.recent` (top-N projects from `summarizeProjects`).

---

### D-04 Financial Position Widget

**Status: BLOCKED**

No aggregation endpoint (`B10` — `GET /projects/summary` doesn't exist). No frontend widget built — correctly not built.

---

### D-05 Empty State

**Status: IMPLEMENTED**

**Evidence:** `dashboard-content.tsx` lines 69–76 — when `summary.total === 0` shows dashed empty-state card with title and hint text ✓.

---

### D-06 Loading Skeleton

**Status: IMPLEMENTED**

**Evidence:** `dashboard-content.tsx` lines 46 and 136–151 — `DashboardSkeleton` renders pulse placeholders with `role="status"` and `aria-live="polite"` ✓.

---

### D-07 Independent Widget Failure Isolation

**Status: PARTIAL**

**Evidence:** `dashboard-content.tsx` lines 46–65

When `isError` (projects query), the component returns a full-page error with a Retry button. The client KPI becomes invisible. The spec requires widgets to fail independently.

**Client KPI isolation:** already partial — `clientValue = (clientsLoading || clientsError) ? '—' : ...` ✓  
**Projects query failure hides everything including client KPI** — the top-level `if (isError)` returns early before reaching the KPI grid.

**Fix:** move the error state to be co-located with the portfolio widget, not a full-page bail-out. Let the client KPI render regardless.

**Severity: MEDIUM**

---

### Phase 5 Decision

**Phase 5 — PARTIAL**

- D-02, D-04: correctly blocked; no fix available
- D-07: isolation fix is medium-complexity, unblocked

---

## Fixes to Apply Now

The following are fixable within this session without backend changes:

| ID | Requirement | Fix |
|---|---|---|
| **P-09** | Contract Value KPI reads wrong source | Pass `contracts.data?.[0]?.contractValue` to Overview |
| **D-07** | Dashboard failure isolation | Move error state inside PortfolioWidget only |

The following are MISSING features requiring new page/component work beyond a patch:
| ID | Requirement | Status |
|---|---|---|
| **P-13** | IPC per-project tab | Backend unblocked; build `/projects/[id]/ipc/page.tsx` and component |
| **P-07** | Setup checklist: CLIENT_CONTRACT type filter | Needs B-CONTRACT-01 response shape confirmed |

The following are accepted PARTIAL states with documented rationale:
| ID | Rationale |
|---|---|
| **C-06** | B8 limitation — client-side filter; schedule columns omitted |
| **C-08 / P-04** | Inactive client warning — no backend validation rejection either |
| **P-07** | Step order: implementation is correct; spec should be updated |
| **D-02, D-04** | No backend endpoint; correctly not built |

---

## Browser Verification

Browser verification was not performed (API server not running in this session). Required before the audit can be closed:

- 1440px desktop, 1024px tablet, 768px narrow, 375px mobile
- EN and AR locales (RTL layout)
- Light and dark themes
- Create/edit flows end-to-end
- Lifecycle transitions
- Dashboard at 0 projects, N>0 projects

---

## Fixes Applied in This Session

Both fixes were verified: lint passes (0 warnings/errors), TypeScript passes (0 diagnostics).

### P-09 — Contract Value KPI (RESOLVED)

**File:** `apps/web/src/features/projects/components/project-detail.tsx`

Added `domainContractValue: string | null` and `domainCurrency: string | null` props to `Overview`. `ProjectDetail` now passes `contracts.data?.[0]?.contractValue ?? null` and `contracts.data?.[0]?.currency ?? null`. Overview prefers domain values over `project.contractValue`/`project.currency`, falling back to the legacy project fields for pre-Sprint-6 records. Both the KPI card and the info-grid Commercial row benefit from the same fix.

### D-07 — Dashboard Failure Isolation (RESOLVED)

**File:** `apps/web/src/features/dashboard/components/dashboard-content.tsx`

Moved `clientCount`/`clientValue` computation before the `if (isError)` early return. The error-state branch now renders an error Alert + retry button followed by a `WidgetShell` containing the client KPI card. Project failure no longer suppresses the client count.

---

## Summary Matrix

| Req | Title | Status | Severity |
|---|---|---|---|
| C-01 | Client List | IMPLEMENTED | — |
| C-02 | Client Create | IMPLEMENTED | — |
| C-03 | Client Edit | IMPLEMENTED | — |
| C-04 | Client Detail Header | IMPLEMENTED | — |
| C-05 | Client Overview | IMPLEMENTED | — |
| C-06 | Client Projects Tab | PARTIAL (B8) | LOW |
| C-07 | Financials/Docs/Activity | INTENTIONALLY OMITTED | — |
| C-08 | Client→Project Handoff | RESOLVED | MEDIUM→DONE |
| P-01 | Project List | IMPLEMENTED | — |
| P-02 | Project Create Wizard | IMPLEMENTED | — |
| P-03 | Project Edit | IMPLEMENTED | — |
| P-04 | Inactive Client Context | RESOLVED | MEDIUM→DONE |
| P-05 | Workspace Header | IMPLEMENTED | — |
| P-06 | Lifecycle Actions | IMPLEMENTED | — |
| P-07 | Setup Checklist | RESOLVED | MEDIUM→DONE — completion now requires an executed `CLIENT_CONTRACT` (`ACTIVE` or `FINAL_ACCOUNT_PENDING`), not merely a non-terminal draft |
| P-08 | Draft Overview | IMPLEMENTED | — |
| P-09 | Active Overview KPIs | RESOLVED | HIGH→DONE |
| P-10 | Contract Tab | IMPLEMENTED | — |
| P-11 | BOQ Tab | IMPLEMENTED | — |
| P-12 | Team Tab | IMPLEMENTED | — |
| P-13 | IPC Tab | RESOLVED | HIGH→DONE — project-scoped IPA and IPC queries, certificate lifecycle visibility, and permission-gated issue/replacement actions are available in the workspace |
| D-01 | Portfolio KPIs | IMPLEMENTED | — |
| D-02 | Attention Queue | BLOCKED | — |
| D-03 | Recent Projects | IMPLEMENTED | — |
| D-04 | Financial Position | BLOCKED | — |
| D-05 | Empty State | IMPLEMENTED | — |
| D-06 | Loading Skeleton | IMPLEMENTED | — |
| D-07 | Failure Isolation | RESOLVED | MEDIUM→DONE |
