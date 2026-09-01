# Administration workspace — governance redesign (REVIEW + BUILD-SPEC)

Status: **REVIEW / BUILD-SPEC ARTIFACT** — structure, IA, per-screen layout, component mapping, state matrix.
Not production React, not final pixels. Hand to frontend-engineer once approved.
Owner: Product Design · Scope: `apps/web` Administration area · Tenant: ACCO (English-only, no RTL, dark + 375px in QA).
Design system: **enterprise-design-system** (Meridian indigo accent) · consume `@erp/ui` + tokens only.

Grounded in the real build:
- Nav model — `apps/web/src/components/layout/nav-groups.ts` (already supports `groupKey`).
- Workflows — `apps/web/src/features/workflows/components/*` and `app/(app)/admin/workflows/page.tsx`.
- Users / Roles — `apps/web/src/features/{users,roles}/components/*` and their admin pages.
- Design DNA — `enterprise-design-system/README.md`; patterns from `screens/{workspace,entity-detail,create-form,entity-list}.html`.

**The job:** the functionality is fully built and ahead of its visual polish. This is a **visual/structural
consolidation**, not new features and not backend work. The headline is promoting the 500-line policy
`<Sheet>` (a 4-tab `ViewSwitcher` stacking four domains in one scroll) to a **full-page governance workspace**.

Legend: **NEW** · **REFINED** (exists, restructured) · **MOVED** (same component, new home) ·
**RETIRED-as-primary** (still reachable/reused, no longer the main surface) · **DEFERRED** (aspirational nav
item with no backend — flagged, never stubbed).

---

## 0. Baseline — what exists today (so we refine, not reinvent)

| Area | Today | File |
|---|---|---|
| Admin nav | Flat 5-item column: Users, Roles, Districts, Workflows, Audit logs — no grouping, mixes people/org/governance/evidence | `nav-groups.ts:144-155` |
| `/admin` | Redirects to `/admin/users` | `admin/page.tsx` |
| Workflows page | One page stacks 3 sections: `GovernanceBindingsPanel` + `ApprovalPolicyInventory` + `WorkflowDefinitionViewer` under a plain `PageHeader` | `admin/workflows/page.tsx` |
| Policy inventory | Section heading + "New draft" button + table (Policy/Status/Version/Rules/Actions). Row click opens the builder **Sheet**; "Compare versions" opens a second **Sheet**. New-draft is a third **Sheet** | `approval-policy-inventory.tsx` |
| **Policy builder** | **500-line `<Sheet>`**: title (`key · v · status`) + lifecycle buttons + a **4-tab `ViewSwitcher`** (Rules / SoD / Simulate / History) all scrolling in one drawer; hosts edit-rule + lifecycle dialogs | `policy-rule-builder-sheet.tsx` |
| Add-rule form | Matrix-pinned transaction/transition, rule key, role, priority, amount bands | `policy-add-rule-form.tsx` |
| SoD editor | Add form (code + description) + toggle table; DRAFT-only writes | `policy-sod-editor.tsx` |
| Simulation | Dry-run panel: transaction picker + amount → matched chain / rejected-with-reasons; DRAFT + `manage:workflow` only | `policy-simulation-panel.tsx` |
| History | Read-only dots+connector timeline (action · reason · actor · time) | `policy-history-timeline.tsx` |
| Version comparison | `<Sheet>`: version roster + base/target selects → `PolicyComparisonDiff` | `policy-version-comparison-sheet.tsx` |
| Clone / rollback | `<Dialog>` with reason + rollback-impact diff (active vs cloned) | `clone-policy-dialog.tsx` |
| Bindings | Read-only "what is actually gated" table; **intentionally no write** (endpoint withheld, ADR-007) | `governance-bindings-panel.tsx` |
| Definition viewer | Transaction-type select → conditions + steps tables, read-only | `workflow-definition-viewer.tsx` |
| Users | Toolbar "Add user" + table (Name/Email/Roles/Status/⋯); row `⋯` → edit / set password / regenerate temp / manage roles / (de)activate. 4 form **Sheets** | `users-list.tsx`, `user-form-sheets.tsx` |
| Roles | "Add role" + table (Name/Governance/Permissions#/Members#/⋯); SYSTEM roles protected; CUSTOM row `⋯` → view impact / edit / permissions / delete. Form **Sheets** + governance sheet | `roles-list.tsx`, `role-form-sheets.tsx` |
| Districts | Manager list, gated `manage:district` | `districts-manager.tsx` |
| Audit logs | Evidence list | `admin/audit-logs/page.tsx` |

Three truths from the code that constrain everything below:

1. **Permission keys are real; enforcement is the API's job.** `manage:workflow` (author rules/SoD, submit),
   `publish:workflow` (schedule/activate/retire), `view:workflow` (read/compare), `manage:user`
   (`PERMISSIONS.usersManage`), `manage:role` (`PERMISSIONS.rolesManage`), `manage:district`. The UI **hides**
   affordances it can't grant; it never implies the server will accept them. Keep every existing gate exactly.
2. **DRAFT is the only writable status.** Rules, SoD, and simulation are authoring surfaces that exist only
   while `status === 'DRAFT'` **and** the caller has `manage:workflow` (`editable` in the current code). Every
   other version is read-only. The workspace must carry this through — it is the spine of the lifecycle.
3. **Some governance is deliberately read-only.** Bindings and the definition viewer have **no write endpoint
   on purpose** (ADR-007 placeholder chains). They stay read surfaces with an honest "why no toggle" note — do
   not design a control the platform withholds.

---

## 1. Restructured admin IA / navigation

The flat 5-item admin column mixes four different jobs. Group them with the **existing `groupKey`
mechanism** (`nav-groups.ts` — a quiet micro-label divider, not a second collapsible level, not a nested tab).
Domain stays `Administration → /admin`. `/admin` redirect retargets to `/admin/users` (People, unchanged).

```
Administration  (domain header → /admin → redirect to /admin/users)
│
├─ People                                    groupKey: 'people'
│   Users              /admin/users                        manage:user (view open)   REFINED
│   Roles              /admin/roles                         manage:role (view open)   REFINED
│   Access reviews     — (no route)                         —                         DEFERRED
│
├─ Organization                              groupKey: 'organization'
│   Districts          /admin/districts                     manage:district           MOVED (unchanged)
│
├─ Approval governance                       groupKey: 'governance'
│   Policies           /admin/workflows                     view:workflow             REFINED (inventory)
│   Workflow builder   /admin/workflows/[policyId]          view:workflow             NEW (deep route)
│   SoD rules          — (no standalone org route)          —                         DEFERRED
│
└─ Evidence                                  groupKey: 'evidence'
    Audit logs         /admin/audit-logs                    (existing gate)           MOVED (unchanged)
```

**Nav-model changes required (frontend-owned, in `nav-groups.ts`):**
- Add a `groupKey` to each of the four Administration items above. `groupNavItems()` already renders grouped
  runs under a `nav.group.<key>` micro-label; add four `nav.group.*` strings (`people`, `organization`,
  `governance`, `evidence`) to `messages/en/*`. Ungrouped items lead, grouped follow — so declare items in the
  grouped order shown.
- **"Workflow builder"** is the same route family as Policies (`/admin/workflows` list, `/admin/workflows/[id]`
  detail). It does **not** need a second nav item — the list *is* the entry, and the builder is a row click.
  Listed above only to show where the deep route lives; **do not add a duplicate nav row** (it would fail
  `isActiveNavItem`'s prefix match and highlight two rows at once). Keep one "Policies" item.

### DEFERRED items (flagged, not built — no backend)

| Item | Why deferred | What it would need |
|---|---|---|
| **Access reviews** (People) | No endpoint for periodic user/role attestation. There is no "review campaign" aggregate in the API. | A backend access-review module. Until then, do **not** add the nav row — an item that 404s is worse than an absent one. Documented here as the intended People slot. |
| **SoD rules** (standalone, org-level, Governance) | SoD rules exist **only per-policy-draft** (`policy-sod-editor.tsx` → `POST /workflows/policies/:id/sod-rules`). There is no org-level SoD registry endpoint. | A cross-policy SoD read/registry endpoint. Today SoD lives on the **Segregation of Duties tab** inside a policy workspace (§3.4) — which is correct and sufficient. The standalone nav item is aspirational only. |

Everything else maps to a **live route**. No other invention.

---

## 2. Screen inventory (tagged vs today)

| # | Screen / surface | Tag | Route | Primary action |
|---|---|---|---|---|
| S1 | **Governance Builder workspace shell** (header + tab bar + validation rail) | **NEW** | `/admin/workflows/[policyId]` | (per-tab; lifecycle in header) |
| S1a | · Overview tab | **NEW** | `…/[policyId]` (default) | Advance lifecycle |
| S1b | · Rules tab | **REFINED** (from `ViewSwitcher`) | `…/[policyId]?tab=rules` | Add rule |
| S1c | · Segregation of Duties tab | **REFINED** | `…?tab=sod` | Add SoD rule |
| S1d | · Simulation tab | **REFINED** | `…?tab=simulation` | Run simulation |
| S1e | · History tab | **REFINED** | `…?tab=history` | — (read-only) |
| S2 | **Policy inventory** (list) | **REFINED** | `/admin/workflows` | New draft |
| S3 | Governance reference (Bindings + Definitions) | **MOVED** | `/admin/workflows` (below inventory) or `?ref` | — (read-only) |
| S4 | **Users** table + dialogs | **REFINED** | `/admin/users` | Add user |
| S5 | **Roles** table + dialogs | **REFINED** | `/admin/roles` | Add role |
| S6 | **Standard form / lifecycle dialog** template | **NEW** (spec) | (overlay) | one primary |
| — | Version comparison | **MOVED** (Sheet → Overview action / Rules) | overlay from S1a | — |
| — | Clone / rollback preview | **MOVED** (floats on inventory → header action) | overlay from S1 header | Create draft clone |
| — | Long builder `<Sheet>` | **RETIRED-as-primary** | (deleted as a surface; its 5 child components move into S1) | — |

---

## 3. Governance Builder workspace — `/admin/workflows/[policyId]` (S1)

Pattern base: `screens/workspace.html` (identity header + sub-nav tabs) crossed with
`screens/entity-detail.html` (lifecycle bar + status rail). One workspace, one **surface**, tabs — **not a
wizard** (anti-pattern: "no wizard where a form works"). Authoring progress is a *cue* on Overview, not a gate.

### 3.0 Shell — header + tab bar + optional validation rail (every tab shares this)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Administration ›  Policies ›  PURCHASE_ORDER_APPROVAL                        (breadcrumb)   │
│                                                                                            │
│ PURCHASE_ORDER_APPROVAL           [ DRAFT ]        Submit for review  ·  Clone   [ ⋯ ]      │
│ PO-APPROVAL · v3 · edited 12 Aug 2026, 09:14 by A. Salam        (mono key · tabular v)      │
│                                                                                            │
│ ● Draft ──── ○ In review ──── ○ Scheduled ──── ○ Active ──── ○ Retired    (Lifecycle bar)  │
│                                                                                            │
│ [ Overview ]  Rules 6   Segregation of duties 2   Simulation   History              (Tabs) │
├──────────────────────────────────────────────────┬─────────────────────────────────────────┤
│                                                  │  VALIDATION                (sticky rail)  │
│  <active tab content>                            │  ● Draft valid — ready to submit          │
│                                                  │  ────────────────────────────────────     │
│                                                  │  Rules            6                        │
│                                                  │  SoD rules        2 active                 │
│                                                  │  Effective from   — (set on schedule)      │
│                                                  │  Bound triggers   1                        │
│                                                  │  [ Validate draft ]                        │
└──────────────────────────────────────────────────┴─────────────────────────────────────────┘
```

- **Header** = record header from `entity-detail.html`: page-title `policyKey` (20/28·600) + a tinted status
  `Badge`; a mono/tabular meta line (`policyKey · v{version} · last-edit`). Lifecycle actions right-aligned —
  **one primary**, per status (below); secondary/overflow demoted.
- **Lifecycle bar** = DS `Lifecycle` (dots + connectors, Design DNA #7): `Draft → In review → Scheduled →
  Active → Retired`. States: `completed` (past) / `current` (now) / `upcoming` (future). RETIRED shows as a
  `cancelled`/terminal end-cap when reached. Small, never oversized.
- **Tabs** = DS `Tabs` with counts: **Overview · Rules `{n}` · Segregation of duties `{n}` · Simulation ·
  History**. Overview is default. Deep-linkable via `?tab=`. Simulation tab is **only present** when
  `editable` (DRAFT + `manage:workflow`) — same rule the current `ViewSwitcher` uses; on a non-draft it is
  simply absent (not disabled-and-noisy).
- **Validation rail** = opt-in `Panel` (side rail like `entity-detail`'s financial summary). Sticky on
  desktop; holds the **quick stats** + the **`Validate draft` action** + the pass/fail `Alert`. On a non-draft
  the rail drops the Validate button and shows read-only stats only. It is genuinely bounded content, so a
  Panel is warranted (per DS "panels are opt-in").

**Lifecycle actions — one primary per status, permission-gated (unchanged logic, relocated to header):**

| Status | Primary (header) | Gate | Secondary / overflow |
|---|---|---|---|
| DRAFT | **Submit for review** | `manage:workflow` | Clone · Delete-draft (⋯) |
| IN_REVIEW | **Schedule** (needs effective date) | `publish:workflow` | Clone · Return to draft¹ |
| SCHEDULED | **Activate** | `publish:workflow` | Clone |
| ACTIVE | **Retire** (outline, not primary — destructive-ish) | `publish:workflow` | Clone · Compare versions |
| RETIRED | (none) | — | Clone (→ new draft = rollback) |

¹ only if the API exposes it — current code offers `submit-review / schedule / activate / retire` only; keep
that set. Do not invent "return to draft" if the endpoint is absent.

Each action opens the **lifecycle dialog** (§6) — reason required, effective date when `needsDate`. These are
the exact `LIFECYCLE_COPY` transitions already in `policy-rule-builder-sheet.tsx`, moved to the header.

**375px reflow (shell):** header stacks — title + badge on line 1, meta wraps, the **one** primary action goes
full-width below the meta, secondaries collapse into the `⋯` menu. Lifecycle bar scrolls horizontally (dots
stay small). Tab bar scrolls horizontally. **Validation rail moves to the top of the tab content** as a
collapsible `Panel` ("Validation — Draft valid, 6 rules · [Validate]"), above the tab body.

### 3.1 Overview tab (S1a) — NEW

The tab the current build never had. Answers "what is this policy, where is it in its life, and is it ready?"
at a glance — no scrolling four domains to find out.

```
┌────────────────────────────────────────────────────┬──────────────────────────┐
│ POLICY DETAILS                              (SectionHeader + hairline)          │
│                                                     │  VALIDATION (rail)        │
│  Policy key      PURCHASE_ORDER_APPROVAL  (mono)     │  ● Draft valid            │
│  Version         v3                        (tabular) │  ──────────────────       │
│  Status          Draft                     (Badge)   │  Rules          6         │
│  Amount basis    PO gross (USD)                      │  SoD rules      2 active  │
│  Effective from  — (set on schedule)                 │  Effective      —         │
│  Effective to    —                                   │  Bound triggers 1         │
│  Created by      A. Salam · 11 Aug 2026              │  [ Validate draft ]       │
│                                                     │                           │
│ ─────────────────────────────────────────────────── │                           │
│ QUICK STATS                                 (metric strip, divider-separated)   │
│   Rules │ SoD rules │ Validation │ Bound triggers                               │
│     6   │  2 active │  ● Valid   │      1                                        │
│ ─────────────────────────────────────────────────── │                           │
│ LINKED BINDINGS                             (SectionHeader)                      │
│  IPC  SUBMITTED → CERTIFIED   → this chain   Active   (read-only mini-table)     │
│  “What actually gates” — read-only. Manage bindings is withheld by design.      │
│ ─────────────────────────────────────────────────── │                           │
│ VERSIONS                                    (SectionHeader + [ Compare versions ])│
│  v3  Draft    6 rules   ← you are here                                           │
│  v2  Active   6 rules   [ Compare ]  [ Clone → new draft ]                       │
│  v1  Retired  5 rules   [ Compare ]                                              │
└────────────────────────────────────────────────────┴──────────────────────────┘
```

- **Policy details** = `KeyValue` (label-above/left, `entity-detail` style). Metadata: key, version, status,
  amount basis, effective from/to, created-by. Empty values render `—` (never blank).
- **Quick stats** = divider-separated **metric strip** (no KPI cards, DS anti-pattern): rule count, SoD count,
  validation state (words-then-color: "● Valid" / "● 2 issues"), bound-trigger count. Mirrors the rail so the
  fact is visible whether or not the rail is collapsed.
- **Lifecycle stage** is the header bar (not duplicated here).
- **Linked bindings** = a compact read of `GovernanceBindingsPanel` **filtered to this policy's transitions** —
  the honest "what is actually gated". Read-only, carries the existing "no toggle by design" note.
- **Versions** = the version roster from `policy-version-comparison-sheet.tsx`, promoted onto Overview.
  **`Compare versions`** opens the comparison overlay (was a floating Sheet on the inventory — now anchored
  here, §3.6). **`Clone → new draft`** opens the clone/rollback dialog (§3.7). This is where "version
  comparison + clone/rollback fit into the workspace cleanly" is realized.

**Authoring progress cue (not a wizard):** on a DRAFT, Overview shows a one-line inline hint under Policy
details — e.g. "Add rules → add SoD → validate → submit." derived from state (0 rules ⇒ "Start by adding a
rule on the Rules tab"). It **links** to tabs; it never blocks them.

**375px:** single column. Rail → collapsible Validation panel on top. Details `KeyValue` stacks. Metric strip
becomes a 2×2 grid. Versions list stacks; per-row actions wrap under each row.

### 3.2 Rules tab (S1b) — REFINED (from the `ViewSwitcher` "rules" view)

Same content as today's builder sheet "Rules" view, given room to breathe on a full page.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ RULES                                    Add rule (primary, top-right)          │
│  Priority-ordered. Draft only — edits disabled on published versions.           │
│                                                                                 │
│  RULE            TRANSACTION        TRANSITION          ROLE        PRIORITY  ⋯  │
│  ────────────────────────────────────────────────────────────────────────────  │
│  PO_BAND_0_10K   Purchase order     SUBMITTED→APPROVED  Buyer            0    ⋯  │
│  PO_BAND_10_50K  Purchase order     SUBMITTED→APPROVED  Manager         10    ⋯  │
│  PO_BAND_50K_UP  Purchase order     SUBMITTED→APPROVED  Director        20    ⋯  │
│                                                       (mono keys, tabular pri)   │
│  ── ⋯ row menu (DRAFT + manage:workflow only) ──                                │
│     Edit rule · Move up · Move down · Delete                                     │
└───────────────────────────────────────────────────────────────────────────────┘
```

- Table = DS `DataTable`: uppercase gray headers, hairline rows, mono rule keys, **tabular** priority,
  right-aligned. Empty → "No rules yet" `TableEmpty`. The per-row edit/up/down/delete cluster (currently four
  ghost buttons) consolidates into a **`⋯` `RowActions` overflow** (matches Users/Roles) — cleaner, and only
  rendered when `editable`.
- **Add rule** (`PolicyAddRuleForm`, unchanged) is the tab's one primary action. On desktop it can sit in a
  right rail `Panel` or open as an inline reveal below the table; on a fresh empty draft, show it inline
  expanded (nothing else to do). The matrix hint block (approved transition / basis / chain) is kept verbatim —
  it is load-bearing (stops the server 400).
- **Validate** moves out of the tab body into the **validation rail** (§3.0) so it is reachable from every tab.
- **Edit rule** stays an overlay `Dialog` (§6), matrix-pinned, exactly as today.

**Read-only (non-draft or no `manage:workflow`):** table only, no `⋯`, no add form, no validate button.

**375px:** `TableScroll` horizontal (keep Rule + Priority visible; scroll Transaction/Transition/Role). Add-rule
form is a full-width stacked form below.

### 3.3 (folded into 3.2 header) — n/a

### 3.4 Segregation of Duties tab (S1c) — REFINED

`PolicySodEditor` verbatim, on its own tab instead of buried third in a `ViewSwitcher`.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ SEGREGATION OF DUTIES                                                            │
│  Constraints that block one actor from both requesting and approving.           │
│                                                                                 │
│  ┌ Add rule (DRAFT + manage:workflow) ─────────────────────────────────┐        │
│  │ Code  PO_NOT_SELF_APPROVE        Description  Requester ≠ approver    │        │
│  │                                                        [ Add ]        │        │
│  └──────────────────────────────────────────────────────────────────────┘        │
│                                                                                 │
│  CODE                 DESCRIPTION                    STATUS      ⋯               │
│  ─────────────────────────────────────────────────────────────────────         │
│  PO_NOT_SELF_APPROVE  Requester ≠ approver           Active     Deactivate      │
│  PO_TWO_PERSON        Two distinct approvers > 50k    Inactive   Activate        │
└───────────────────────────────────────────────────────────────────────────────┘
```

- No change to logic; the upsert-toggles-on-code behaviour is kept. Status uses words-then-color (`Badge`
  live/neutral, "Active"/"Inactive"). Add-form is DRAFT-only. **375px:** code/description stack; table scrolls.

### 3.5 Simulation tab (S1d) — REFINED (present only when `editable`)

`PolicySimulationPanel` verbatim. The tab **does not render** for non-draft / viewer (same gate as today's
conditional `ViewSwitcher` item), rather than showing a disabled tab.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ SIMULATE DRAFT                                                                   │
│  Dry-run — no approval instance or transaction is created.                       │
│                                                                                 │
│  Transaction type  [ Purchase order ▾ ]    Transition  SUBMITTED → APPROVED     │
│  Amount            [ 25000 ]  (optional; omit to ignore bands)     [ Run ]       │
│  ────────────────────────────────────────────────────────────────────────       │
│  RESULT                                                                          │
│  ⚠ Ambiguous chain — two rules share priority 10       (Alert, only when true)   │
│  Matched chain                                                                   │
│   #  RULE            ROLE       PRIORITY                                          │
│   1  PO_BAND_10_50K  Manager        10                                           │
│  Rejected rules (why excluded)                                                   │
│   PO_BAND_0_10K   · amount 25,000 above band max 10,000                          │
└───────────────────────────────────────────────────────────────────────────────┘
```

States (all already handled by the component): idle · empty (no rules → prompt, Run disabled) · running · error
· no-match · clean match · ambiguous (warning `Alert`) · rejected-with-reasons. **375px:** inputs stack; result
tables scroll.

### 3.6 History tab (S1e) — REFINED (read-only)

`PolicyHistoryTimeline` verbatim — dots + connector spine, newest first, action · reason · actor · absolute+
relative time. Purely informational, no affordances. Empty → "No history yet". Its dot+connector styling is
already Design-DNA-correct; leave it.

### 3.6 Version comparison overlay — MOVED (Sheet → Overview action)

Opened from Overview → **Compare versions** (and the ACTIVE header overflow). Keep it a right **`Drawer`**
(the existing `PolicyVersionComparisonSheet` + `VersionComparer`) — a comparison read is legitimately a
side-surface, and anchoring it to the workspace (rather than floating on the inventory) is the fix the spec
asks for. Content unchanged: version roster + base/target selects → `PolicyComparisonDiff`. Single-version and
same-version empty states already handled.

### 3.7 Clone / rollback dialog — MOVED (floats on inventory → workspace header/Overview)

`ClonePolicyDialog` verbatim, opened from the header **Clone** action or Overview version row **Clone → new
draft**. Keeps the rollback-impact preview (active vs cloned diff), reason-required, and the three honest edge
cases (clone-of-active, no-active-version, preview-load-failure never blocks the clone). On success it routes
to the new draft's workspace (`/admin/workflows/[newDraftId]`) — replacing the old "open into the sheet".

---

## 4. Policy inventory — `/admin/workflows` (S2) — REFINED

Pattern: `screens/entity-list.html`. The list stays the inventory; the row now **navigates** to the workspace
route instead of opening a Sheet.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Approval policies                                          [ New draft ]        │
│ Rule sets that gate transactions. One active version per key.                    │
│                                                                                 │
│  ┌ Search policies…            ┐   Status [ All ▾ ]                              │
│                                                                                 │
│  POLICY                    STATUS     VERSION   RULES    ⋯                       │
│  ─────────────────────────────────────────────────────────────                  │
│  PURCHASE_ORDER_APPROVAL   ● Active     v2        6     Compare · Open           │
│    PO gross (USD)                                                                │
│  IPC_CERTIFICATION         ● Draft      v1        4     Compare · Open           │
│    IPC certified (USD)                                                           │
│  ─────────────────────────────────────────────────────────────                  │
│  (empty)  “No approval policies yet. Create a draft to begin.”                    │
└───────────────────────────────────────────────────────────────────────────────┘
```

- Row click → `router.push('/admin/workflows/' + policy.id)` (was `setSelected` → Sheet). The whole builder
  now lives on its own URL — deep-linkable, back-button-correct, shareable.
- Status uses words-then-color (`Status` dot+word; ACTIVE = live). Version/rules **tabular**, right-aligned.
- **Search** by policy key + **Status filter** added (currently absent) — `entity-list` toolbar pattern.
- `New draft` stays the one primary; keep the create `Sheet` **or** promote it to the standard form dialog
  (§6) — both acceptable; a Sheet is fine here since it is a 2-field create.
- **Compare** stays as a quick row action (opens §3.6 overlay), gated `view:workflow`.
- Loading = skeleton; error = `Alert` + retry; empty = dashed `EmptyState`. Unchanged, kept.

**Governance reference (S3, MOVED):** `GovernanceBindingsPanel` + `WorkflowDefinitionViewer` currently stack
below the inventory on the same page. Keep them there under a **"Governance reference"** `SectionHeader`
(read-only bindings + definition viewer) — or move behind a `?ref` view toggle if the page feels long. They are
read surfaces; they do not belong inside a single policy's workspace (they are cross-policy). No logic change.

**375px:** toolbar stacks (search full-width, filter below); table scrolls; `New draft` full-width.

---

## 5. Users & Roles — REFINED (final visual consistency)

Both already use the correct DS grammar (`Table`, status `Badge`, `RowActions` `⋯`, dashed empty, skeleton
loading, `Alert`+retry error). The refinement is **consistency + the missing toolbar bits**, not a rebuild.

### 5.1 Users table (S4)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Users                                                       [ Add user ]        │
│                                                                                 │
│  ┌ Search name or email…        ┐   Status [ All ▾ ]    [ ☐ 2 selected ▾ ]      │
│                                                                                 │
│  ☐  NAME                 EMAIL                 ROLES            STATUS      ⋯     │
│  ────────────────────────────────────────────────────────────────────────      │
│  ☐  Amina Yusuf (you)    amina@acco.so         Admin, Finance   ● Active    ⋯    │
│  ☐  Kofi Osei            kofi@acco.so          Procurement      ● Active    ⋯    │
│  ☐  Mira Chen            mira@acco.so          —                ○ Inactive  ⋯    │
│  ────────────────────────────────────────────────────────────────────────      │
│  ⋯ row menu: Edit · Set password · Regenerate temporary · Manage roles          │
│              · Deactivate / Reactivate                                           │
└───────────────────────────────────────────────────────────────────────────────┘
```

Refinements (all `manage:user`-gated, additive):
- **Search** (name/email) + **Status filter** (All / Active / Inactive) — client-side over the existing list.
- **Bulk actions** where sensible: a leading selection checkbox + selection footer (DS table pattern) with
  **Deactivate / Reactivate selected** only. **Never** bulk delete or bulk set-password (destructive/credential
  actions stay per-row and explicit). The current-user row is **not selectable for deactivate** (API rejects
  self-deactivation — the existing per-row rule; enforce it in bulk too).
- Column hierarchy: Name (medium weight, "(you)" muted) · Email (muted) · Roles (`UserRolesCell` chips) ·
  Status (`UserStatusBadge`, words-then-color) · `⋯`.
- States kept verbatim: skeleton (`role=status`), `Alert`+retry, dashed empty ("No users yet" + hint).

Dialogs (S6 grammar, existing `user-form-sheets.tsx`): **Add user** (email + first/last + roles → temp-cred
summary with copy), **Edit**, **Set password**, **Manage roles**, **Regenerate temporary**. These are correct
sheets already; align them to the §6 template (title/helper/labelled inputs/one primary). Add-user's
post-create `CredentialsSummary` is a good pattern — keep it.

### 5.2 Roles table (S5)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Roles                                                       [ Add role ]        │
│                                                                                 │
│  ┌ Search roles…                ┐   Kind [ All ▾ ]                              │
│                                                                                 │
│  NAME                    GOVERNANCE / OWNER            PERMISSIONS  MEMBERS  ⋯   │
│  ────────────────────────────────────────────────────────────────────────      │
│  Admin      System       Full platform · owner —            42       3    View  │
│  Finance    Custom       AP/AR · owner amina@acco.so         18       5     ⋯    │
│  Buyer      Custom       Procurement · owner kofi@acco.so    11       9     ⋯    │
│  ────────────────────────────────────────────────────────────────────────      │
│  ⋯ row menu (CUSTOM only): View impact · Edit · Manage permissions · Delete      │
│  SYSTEM roles: “Protected” → View impact only                                    │
└───────────────────────────────────────────────────────────────────────────────┘
```

Refinements (all `manage:role`-gated):
- **Search** (name) + **Kind filter** (All / System / Custom) — client-side.
- Keep the SYSTEM-vs-CUSTOM distinction exactly: SYSTEM rows show a **"Protected"** affordance → governance
  ("view impact") only; CUSTOM rows get the full `⋯`. **No bulk actions on roles** — deletion is a single,
  consequence-heavy act guarded by the confirm dialog (409 in-use / ADMIN protection); bulk would be dangerous
  and adds no real value. State this as a deliberate omission.
- Permissions# / Members# **tabular**, right-aligned. Governance/owner column as a two-line muted cell (owner
  email · template) exactly as today. Delete stays the `ConfirmActionDialog` with 409 handling on-dialog.
- States kept verbatim.

**375px (both tables):** toolbar stacks; `TableScroll` keeps Name + primary metric visible, scrolls the rest;
`⋯` menu is thumb-reachable (≥44px). Bulk footer (users) docks bottom, full-width.

---

## 6. Standard form / lifecycle dialog template (S6) — NEW (spec)

One visual language for every overlay — modelled on the "Add role" reference and `screens/create-form.html`.
This standardizes `user-form-sheets.tsx`, `role-form-sheets.tsx`, the lifecycle transition dialog, edit-rule,
and clone.

```
┌──────────────────────────────────────────────┐
│  Schedule policy                     (title, 16/24·600)     │
│  A second administrator is required — the      (helper, muted, states the rule/consequence)
│  submitter cannot schedule their own draft.    │
│  ────────────────────────────────────────────  (hairline)  │
│                                                │
│  Decision reason *              (label above)  │
│  [ …………………………………………………………………………………… ]         │
│                                                │
│  Effective from *                              │
│  [ 2026-08-20  14:00 ]           (only when needsDate)      │
│                                                │
│  ⚠  Activating governs live transactions.      (optional warning block — Alert, only when it applies)
│                                                │
│  ────────────────────────────────────────────  (hairline)  │
│                          [ Cancel ]  [ Schedule policy ]    (footer: secondary + ONE primary)
└──────────────────────────────────────────────┘
```

Rules (Design DNA #6 + content fundamentals):
- **Title** = section type (16/24·600), verb-first & specific ("Schedule policy", "Add role", "Set password").
- **Helper** = one plain sentence stating the rule/consequence ("Approving routes it to…") — no marketing, no
  emoji.
- **Inputs** = `FormField` (label above, helper/error below), 36px controls, one field per row (2-col grid only
  for genuinely paired fields like first/last name, min/max amount).
- **Optional warning block** = `Alert` (warning) — shown *only* when the action has a consequence worth naming
  (activate governs live txns; delete role in use; regenerate temp credential). Not decorative.
- **Footer** = hairline divider above; **secondary `Cancel` (outline/ghost) + exactly one primary**
  (left-aligned primary per DS, verb-matches-title). Primary disabled while pending / invalid; label swaps to
  "Scheduling…" on pending.
- **Error** = inline `Alert` above the footer, using `ApiError.messages` when present, else a fallback string
  (the existing `apiMessage` helper). 422 → the "workflow not configured — contact your administrator" copy.
- **Overlay type**: `Dialog` for short confirmations & lifecycle transitions; `Sheet`/`Drawer` for multi-field
  create/edit (Add user, Manage permissions). Both follow the same title/helper/footer grammar.

**375px:** dialog goes full-width bottom-sheet; footer buttons stack full-width (primary on top); one field per
row throughout.

---

## 7. Component mapping (where everything goes)

| Existing component | Today | After | Change |
|---|---|---|---|
| `policy-rule-builder-sheet.tsx` | 500-line Sheet w/ `ViewSwitcher` | **RETIRED as a surface.** Its shell (title/lifecycle/tabs) becomes the **workspace shell** (§3.0); its 5 child views become **tabs**. Its two overlay dialogs (edit-rule, lifecycle) move to the workspace as overlays. | Decomposed into route + shell + tabs. `ViewSwitcher` deleted. |
| `policy-add-rule-form.tsx` | inside sheet "Rules" | **Rules tab** (§3.2) | verbatim |
| rules table (was inline in the sheet) | inline | **Rules tab** table w/ `⋯ RowActions` | four ghost buttons → one overflow |
| `policy-sod-editor.tsx` | sheet "SoD" view | **Segregation of Duties tab** (§3.4) | verbatim |
| `policy-simulation-panel.tsx` | sheet "Simulate" view | **Simulation tab** (§3.5), present only when `editable` | verbatim |
| `policy-history-timeline.tsx` | sheet "History" view | **History tab** (§3.6) | verbatim |
| `policy-version-comparison-sheet.tsx` | floats on inventory | **overlay from Overview / ACTIVE header** (§3.6) | re-anchored to workspace |
| `clone-policy-dialog.tsx` | floats on inventory | **overlay from header / Overview version row** (§3.7); on success routes to new draft's workspace | re-anchored; success nav changed |
| `policy-comparison-diff.tsx` | inside both above | unchanged (used by both overlays) | verbatim |
| `approval-policy-inventory.tsx` | row → Sheet | **row → route push** `/admin/workflows/[id]`; add search + status filter | navigation + toolbar |
| `governance-bindings-panel.tsx` | on workflows page | **stays** on inventory page under "Governance reference"; a **filtered** copy renders on Overview "Linked bindings" | reused, read-only |
| `workflow-definition-viewer.tsx` | on workflows page | **stays** under "Governance reference" | verbatim |
| `users-list.tsx` | table + sheets | **REFINED**: search, status filter, selection + bulk (de)activate footer | additive |
| `roles-list.tsx` | table + sheets | **REFINED**: search, kind filter (no bulk) | additive |
| `user-form-sheets.tsx` / `role-form-sheets.tsx` | sheets | align to **§6 template** | grammar pass |
| `nav-groups.ts` | flat admin items | **grouped** (People / Organization / Approval governance / Evidence) via `groupKey` | data + 4 i18n strings |

**NEW to build:**
- `apps/web/src/app/(app)/admin/workflows/[policyId]/page.tsx` — the workspace route (server shell → client
  `GovernanceWorkspace`).
- `GovernanceWorkspace` client component — header (record header + `Lifecycle` bar + lifecycle actions) + `Tabs`
  + validation `Panel` rail + tab router (`?tab=`). Hosts the moved child components and overlays.
- **Overview tab** component — `KeyValue` details + metric strip + linked-bindings mini-table + versions roster.
- `nav.group.{people,organization,governance,evidence}` i18n strings.

**No new @erp/ui primitives.** Everything maps to existing DS components: `Tabs`, `Lifecycle`, `Badge`/`Status`,
`Panel`/`SectionHeader`, `KeyValue`, `Metric`, `DataTable`/`Table`, `Dialog`/`Drawer`/`Sheet`, `RowActions`,
`Alert`, `EmptyState`, `Skeleton`.

---

## 8. State / action matrix (per surface)

Legend for states: **L** loading (skeleton) · **E** empty · **X** error (`Alert`+retry) · **R** restricted
(permission-gated, affordance hidden) · **P** partial/terminal where relevant.

### Governance workspace (§3)

| Action | Gate | Where | Notes / states |
|---|---|---|---|
| Open workspace | `view:workflow` | route | L skeleton on header+tabs; X = load-failed `Alert`; 404 = "policy not found" |
| Switch tab | `view:workflow` | tab bar | Simulation tab **absent** unless `editable` (R) |
| Add rule | `manage:workflow` **and** DRAFT | Rules | R: form hidden on non-draft/viewer. X: `ApiError.messages`. Matrix hint kept |
| Edit / reorder / delete rule | `manage:workflow` + DRAFT | Rules `⋯` | R hidden otherwise; delete confirms |
| Add / toggle SoD | `manage:workflow` + DRAFT | SoD | R hidden otherwise |
| Run simulation | `manage:workflow` + DRAFT | Simulation | E (no rules → Run disabled + prompt); states idle/running/no-match/ambiguous/rejected/X |
| Validate draft | `manage:workflow` + DRAFT | rail | pass/fail `Alert`; button hidden on non-draft |
| Submit for review | `manage:workflow` (DRAFT) | header | lifecycle dialog; reason required; X on-dialog |
| Schedule | `publish:workflow` (IN_REVIEW) | header | needs effective date; "second admin" copy |
| Activate | `publish:workflow` (SCHEDULED) | header | warning block (governs live txns) |
| Retire | `publish:workflow` (ACTIVE) | header | outline (not primary); confirm |
| Clone → new draft | `manage:workflow` | header / Overview | rollback preview; success → new draft route |
| Compare versions | `view:workflow` | Overview / ACTIVE overflow | overlay; single/same-version empties |
| View history | `view:workflow` | History | E "no history"; read-only |
| Linked bindings / definitions | `view:workflow` | Overview / reference | **read-only by design** (no write endpoint) |

### Policy inventory (§4)

| Action | Gate | States |
|---|---|---|
| List | `view:workflow` | L skeleton · X `Alert` · E dashed "no policies" |
| Search / filter status | `view:workflow` | filter-empty state ("no policies match") |
| Open policy | `view:workflow` | row → route |
| New draft | `manage:workflow` | R: button hidden; X create-failed `Alert` |
| Compare | `view:workflow` | overlay |

### Users (§5.1)

| Action | Gate | States |
|---|---|---|
| List | (view open) | L (role=status) · X `Alert`+retry · E dashed |
| Search / filter | — | filter-empty |
| Add user | `manage:user` | R button hidden; post-create credentials summary; X `ApiError` |
| Edit / Set password / Manage roles / Regenerate temp | `manage:user` | per-row `⋯`; each a §6 dialog; X on-dialog |
| Deactivate / Reactivate | `manage:user` | self-row withheld (API rejects self-deactivation) |
| **Bulk (de)activate** | `manage:user` | selection footer; self excluded; confirm before applying |

### Roles (§5.2)

| Action | Gate | States |
|---|---|---|
| List | (view open) | L · X+retry · E dashed |
| Search / filter kind | — | filter-empty |
| Add role | `manage:role` | R button hidden |
| View impact (governance) | `manage:role` | SYSTEM = only affordance ("Protected") |
| Edit / Manage permissions | `manage:role` | CUSTOM only; §6 dialogs |
| Delete | `manage:role` | CUSTOM only; `ConfirmActionDialog`; 409 in-use/ADMIN on-dialog |
| Bulk | — | **none — deliberate** (deletion too consequential) |

---

## 9. Design-system QA checklist (apply at build)

- Type: page title **20/28·600** (policy key); section **16/24·600**; micro-labels **11 uppercase +5% track**
  (table headers, nav sections, `KeyValue` labels, metric labels); **tabular** numerals for versions, priority,
  rule/SoD/permission/member counts.
- Status = **words then color** everywhere (`Status` dot+word in tables, tinted `Badge` in the header).
- Structure via **1px borders + background steps**; shadows only on overlays (Dialog/Drawer/Sheet). Panels are
  opt-in (validation rail, Overview details) — not a card around every element.
- Radius 6 controls / 8 panels / 12 overlays; **pill only** for badges. Accent scarce (primary action, active
  tab edge, focus ring, `Lifecycle` current dot).
- **One primary action per view** (header lifecycle action per status; "Add rule" per Rules tab; "New draft" per
  inventory; one primary per dialog).
- Tokens only — no hardcoded hex, no inline styles (Tailwind + DS tokens). English-only, **no `rtl:`/`dir`** (and
  remove any dead RTL you touch, as its own pass).
- Every surface represents **L / E / X / R** (§8). Empty values render `—`, never blank. IDs/keys in mono.
- 375px: every screen reflows (§ per-screen notes); touch targets ≥ 44px; tables scroll, forms stack, one
  primary goes full-width.

---

## 10. Open questions & what's DEFERRED

**Open product-policy questions (name them; do not guess into the design):**
1. **Retire confirmation weight.** Retiring an ACTIVE policy stops it gating live transactions. Is a plain
   reason-required dialog enough, or should Retire require typing the policy key (danger-zone gate, like the
   Settings archive pattern)? *Assumed: reason-required dialog, matching the existing transition — flag if the
   domain wants a stronger gate.*
2. **"Return to draft" from IN_REVIEW.** The header table shows it as a *possible* secondary, but the current
   API exposes only `submit-review / schedule / activate / retire`. **Not designed in** unless/until an endpoint
   exists — needs backend confirmation (Abdulsalam).
3. **Where do Bindings + Definitions ultimately live?** They are cross-policy read surfaces. Proposed: keep on
   the inventory page under "Governance reference". If Administration later grows, they may deserve their own
   "Governance reference" route. *Assumed: stay on inventory page for now.*
4. **Users/Roles list size.** Search/filter are client-side over the full list (matches today's fetch). If a
   tenant grows past a few hundred users, this needs server-side pagination — a backend concern, out of scope
   here.

**DEFERRED (aspirational nav, no backend — do NOT stub):**
- **Access reviews** (People) — no access-review/attestation endpoint exists. Nav row omitted until a backend
  module lands; slot documented in §1.
- **Standalone org-level SoD rules** (Governance) — SoD is per-policy-draft only; no cross-policy registry
  endpoint. The **Segregation of Duties tab** inside a policy workspace (§3.4) is the real, sufficient surface.

**Backend boundary honored:** nothing here asks for a new endpoint, field, or response shape. The redesign is
pure `apps/web` + `packages/ui` restructuring over the existing contracts. Read-only surfaces stay read-only;
permission gates and DRAFT-only write rules are preserved exactly as the current code enforces them.
