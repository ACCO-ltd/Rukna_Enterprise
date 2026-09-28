# Project Overview — redesign implementation note

Status: implemented 2026-09-28 (frontend only; no API, schema or migration change).
Scope: the project workspace header and the **Overview** tab. Other tabs untouched.

## 1. What was there (Phase 0 read)

| Area | Before | Source |
|---|---|---|
| Header | Hand-built in the shell: `h1` + `ProjectStatusBadge`, meta line `code · client · district, location`, `ProjectActionsPanel` (primary + kebab). Tabs had icons. | `apps/web/src/components/layout/project-workspace-shell.tsx` |
| Lifecycle stepper | `ProjectLifecycleRail` at the top of Overview for every status except Cancelled — a second lifecycle indicator beside the header pill. | `features/projects/components/project-lifecycle-rail.tsx` (deleted) |
| Preparation card | `ProjectReadiness`: all six steps as equal rows, a "Complete / Ready now / Blocked / Exception allowed" pill per row (`readinessStep` registry vocabulary: Optional = `attention`), "Open task" buttons, "Owner action needed" badges. | `features/projects/components/project-readiness.tsx` |
| Right column | Three `RecordPanel` cards with icon tiles: Project information (incl. Location), Commercial foundation (incl. Currency row), Recent activity (5 events, no "View all"). | `features/projects/components/project-detail.tsx` |
| Primary action | `ProjectActionsPanel`: "Continue setup →" link (to the checklist anchor) while MANDATORY conditions were open, otherwise "Start project". | `features/projects/components/project-actions-panel.tsx` |

**Where the steps come from.** `GET /projects/:id/readiness?command=start` → `ProjectReadinessResponse { ready, conditions[{ code, severity: 'MANDATORY'|'WAIVABLE', satisfied, detail }], deferred[] }` (`packages/types/src/construction.ts`), computed by the pure policy `apps/api/src/business/construction/projects/domain/project-readiness.policy.ts`. Per step there is **only** a boolean `satisfied`.

**Mandatory vs optional.** `severity`. `WAIVABLE` = may be skipped with a per-condition override `{ condition, reason }` (audited as `PROJECT_CONDITION_WAIVED`). Additionally CFO/CEO may waive the two MANDATORY contract conditions (ADR-026 Route 7A, `APEX_WAIVABLE_START_CONDITIONS`).

**Dependencies between steps.** Not in the contract. The old UI kept a client-side `dependsOn` map (contract waits for BOQ, start date waits for contract). Since ADR-032 the server does **not** require a baselined BOQ to record the signed contract (`contract.service.ts`: "No committed BOQ is required"), and production has had an executed contract with the BOQ step still open — so that map encoded a rule the API does not enforce.

**Start project command.** `POST /projects/:id/start` with `evidence { actualStartDate (required), commencementNote?, overrides[] }`; requires `manage:project`; readiness enforced server-side (MANDATORY blocks, WAIVABLE needs an override reason); then `CommandGovernanceService.gateStateTransition` — a 409 with `approvalInstanceId` means pending approval. UI: `ProjectTransitionDialog` + `useGatedCommand` + `ApprovalPanel`.

**Money visibility.** `ProjectWorkspaceSummaryResponse.financialsVisible` (server: `financialPositionView`); when false the server nulls `mainContract.contractValue`. Before this change the UI simply dropped the row when the value was null — a money-blind reader could not tell "hidden" from "absent".

**Reused `@erp/ui` pieces.** `RecordHeader` (refined), `StatusPill` + app status registry, `DefinitionList/DefinitionRow`, `MoneyDisplay` (hidden state), `Avatar`, `Badge`, `Button`. There is no Breadcrumbs component in `@erp/ui`; the shell's breadcrumb was kept.

## 2. What changed

| File | Change |
|---|---|
| `packages/ui/src/components/readiness-checklist.tsx` (**new**) | Generic `ReadinessChecklist` + pure `readinessCounts()`. Steps `{key,title,description,owner,state:'done'\|'open'\|'waiting',optional,waitingFor,doneAt,href,action}`; computed summary; segmented bar (`role=progressbar`, text value); open steps first in sequence; done steps behind a real `aria-expanded` toggle, one line each; waiting = dashed + lock + "Waits for"; labels overridable for i18n; `linkAs` for the router link. Nothing project-specific — reusable for period close etc. |
| `packages/ui/src/components/record-layout.tsx` | `RecordHeader` refined (additive, defaults unchanged): `meta` line, `statusPlacement: 'identifier'\|'title'`, `surface: 'panel'\|'plain'`; below 480px actions always stack under the identity block. |
| `packages/ui/src/index.ts` | Exports the checklist. |
| `components/layout/project-workspace-shell.tsx` | Header now **is** `RecordHeader` (plain surface, status beside title). Meta items carry screen-reader labels; client links to `/clients/:id` when the user has `view:client`; MapPin/Building2 Lucide glyphs. Tab icons removed (the tab component already treated them as optional). |
| `features/projects/components/project-actions-panel.tsx` | "Continue setup" removed. Start is rendered only when readiness has loaded and no un-waivable MANDATORY condition is open for this user; never disabled. Kebab unchanged (Cancel last, destructive). |
| `features/projects/components/project-transition-dialog.tsx` | Title "Start {name}?", one-sentence consequence, per-condition reason labels ("Reason for starting without a delivery team"). Command, payload, gating, approval flow unchanged. |
| `features/projects/components/project-readiness.tsx` | Rewritten as an adapter onto `ReadinessChecklist`; client-side dependency map removed; step-specific action labels (Open BOQ / Open contract / Assign team / Set dates / Assign client), shown only with the permission to open the destination. |
| `features/projects/components/project-detail.tsx` | Stepper removed. Rail = plain hairline sections, 320px, drops below 900px. Project: category, subtype, participation, planned start/completion, derived duration, description. Commercial: model, BOQ `StatusPill` (boqVersion vocabulary), main contract (link only with `view:contract`, direct to `contract-milestones`), contract value via `MoneyDisplay` (hidden state for money-blind), no Currency row. Latest activity: 3 events, avatar + actor · event + time. |
| `features/projects/components/project-lifecycle-rail.tsx` | Deleted (superseded). |
| `lib/status-registry.ts` | `readinessStep` vocabulary removed (only consumer gone; it mapped Optional to a warning tone). |
| `messages/en/platform.json` | New keys for header meta, checklist, dialog and rail; unused keys of the old card removed. |

## 3. Design ↔ code conflicts and decisions

| # | Design shows | Code / domain says | Decision |
|---|---|---|---|
| 1 | Contract step: "Price the contract against the baselined BOQ, approve it and mark it executed." | ADR-032: one "Record Signed Contract" command creates the contract ACTIVE; no tie-out, no approval step. | Copy changed to "Record the signed contract with its value, dates and payment schedule." |
| 2 | "Set the contractual start date — Waits for *Create and execute the main contract*" (dashed, locked). | Readiness contract has no dependency data; the old client map was wrong for BOQ→contract. | ~~No `waiting` state~~ — **resolved by §6**: the server now sends `blockedBy`; the start-date step waits for the contract, nothing waits for the BOQ. |
| 3 | Start opens "the existing ConfirmDialog". | Start needs `actualStartDate`, optional note, per-condition waiver reasons and the approval re-drive — `ConfirmDialog` carries none of these. | Kept the existing start dialog (`ProjectTransitionDialog`), refined title/description/reason labels. Semantics untouched. |
| 4 | "No Start button while required steps are open." | Server lets CFO/CEO waive the two contract conditions (Route 7A). | For CFO/CEO the button can appear with those two open; the checklist still counts them as required. **Since §6 the UI reads `caller.canRun` / `caller.waivableConditions`; the role-name mirror is gone.** |
| 5 | Dates "02 Sep 2026". | App formatter `formatDate` → "Sep 2, 2026"; activity uses `formatDateTime`. | Kept the app's format. |
| 6 | "View all" on Latest activity. | No project-scoped history endpoint; `/admin/audit-logs` is org-wide and needs `view:audit-log`. | **Resolved by §6**: "View all" opens the project history sheet (`GET /projects/:id/activity`) for every member. |
| 7 | Activity as a sentence ("Ahmed Warsame set the planned dates"). | Labels exist only for `project.*` commands, as nouns. | "Actor · label"; since §6 a catalog covers project, team, contract, variation, document, programme/progress, BOQ and commercial events; unknown ones read "<Resource> changed", never a code. |
| 8 | Rail "Project" shows no subtype/description. | Both are project facts not shown elsewhere. | Kept, only when present. |
| 9 | "Participation" label. | Existing shared form label "Participation model". | Kept the shared label. |
| 10 | Tab icons absent. | `WorkspaceTabs.icon` already optional. | Removed (trivial). Tabs/routing otherwise untouched. |

## 4. Needs backend support

None open. All five items shipped on 2026-09-28 — see §6:

1. ~~Step dependencies~~ → `blockedBy` per condition (§6.1 #1).
2. ~~Step completion time~~ → `satisfiedAt` per condition (§6.1 #2, sources §6.2).
3. ~~Per-caller start validity~~ → `caller: { canRun, waivableConditions }` (§6.1 #3).
4. ~~Project-scoped activity history~~ → `GET /projects/:id/activity` (§6.1 #4, selection §6.3).
5. ~~Activity labels~~ → `command` + `resourceType` on every event and a web label catalog (§6.1 #5). A server-provided display verb was not added: labels stay a client (i18n) concern.

## 5. Verification

- `apps/web`: `vitest run` — **222 files, 2492 tests passed**. New/rewritten: `features/design-system/readiness-checklist.test.tsx`, `features/projects/components/project-readiness.test.tsx`, `project-detail.test.tsx`, `project-actions-panel.test.tsx`, `components/layout/project-workspace-shell.test.tsx`. Covers: summary for required-open / optional-only / all-done; Start hidden while required steps are open and without `manage:project`; waiver reason required; done steps collapsed by default; money-blind hidden state (not $0); keyboard operation of the toggle.
- ESLint on changed files: 0 errors, 0 warnings (`packages/ui` has no lint target).
- Typecheck: clean for `apps/web/src` + `packages/ui`. `npm run type-check` currently fails only on the generated `.next/dev/types/validator.ts`, which the locally running dev server had left half-written; unrelated to source.
- Visual: Playwright against the local dev server with every API call stubbed (no real data touched), 1440 / 1024 / 768 / 375 × light / dark × required-open, optional-only, all-done, money-blind, after-start (Active) — 40 captures plus Start dialog and expanded done list. Automated per capture: no horizontal overflow, no stepper, no Currency row, no `$0.00`, no page errors, Start present only when valid, hidden-money state for money-blind. Focus stays on the toggle after Enter.
- Not verified: the real start → approval → Active transition against a live API (stubbed only); contrast was reviewed by eye, not measured. Pre-existing, out of scope: at exactly 768px the eight-tab row is wider than the shell and "Team" is clipped by the shell's `overflow-hidden`.

## 6. Backend follow-up (readiness + activity)

Status: **shipped 2026-09-28** (uncommitted). Additive API only — no migration, no new status, no field removed or renamed. Authorization identical or stricter; the API stays the security boundary.

### 6.1 Plan

| # | Item | Server (where) | Web |
|---|---|---|---|
| 1 | **Step dependencies** — `blockedBy: string[]` per condition | Pure map `READINESS_DEPENDENCIES` in `project-readiness.policy.ts`, emitted only for codes present in the same response. The only genuine data dependency today: `CONTRACT_START_DATE` → `ACTIVE_MAIN_CONTRACT` (the start date is read off the effective main contract; `record-signed` creates both in one act). **No BOQ → contract edge**: `ContractService.recordSigned` needs a live BOQ whose operational version passes BOQ readiness, not a committed/baselined one (ADR-032). No client → contract edge either: `recordSigned` takes the client in its body and does not read the project's client status. | `project-readiness.tsx`: an unmet step whose `blockedBy` names an unmet step → `state: 'waiting'`, `waitingFor` = that step's title, no action. |
| 2 | **Completion time** — `satisfiedAt: string \| null` per condition | Loaded by the repository into the snapshot (`evidence`), resolved by the pure policy only when the condition is satisfied. Sources in 6.2. | `doneAt` = `formatDate(satisfiedAt)`. |
| 3 | **Per-caller validity** — `caller: { canRun, waivableConditions }` on `ProjectReadinessResponse` | `ProjectService.getReadiness` → pure `evaluateCaller(readiness, { mayRun, apexAuthority })` which reuses `planEnforcement` with a synthetic reason for each waivable condition. `mayRun` = `manage:project` (the permission every readiness command requires); apex = the existing Start-chain CFO/CEO rule, now one private helper shared with `enforceReadiness`. Status/suspension and governance approval are not part of `canRun` (the lifecycle state machine and the approval gate still decide). | `project-actions-panel.tsx` and `project-transition-dialog.tsx` read `caller.*`; the CFO/CEO string checks are removed. New `showPrimary?: boolean` (default `true`) on the actions panel hides the forward lifecycle button only (Resume and the kebab stay). |
| 4 | **Project activity** — `GET /projects/:id/activity?cursor=&limit=` | Project-scoped (`@ProjectScoped('id')` + `assertMember`), `view:project`. Newest first, `(createdAt, id)` keyset cursor, default 25, max 100. Selection = the existing `recentActivity` selection widened to rows that can be tied to the project reliably (6.3), each family gated by the permission that reads it. `recentActivity` on the workspace summary becomes the first 5 of the same stream. | "View all" opens a side `Sheet` (repo convention: `BoqTimelineDrawer`) for every project member, with "Load more" (`useInfiniteQuery`). The `/admin/audit-logs` link is gone. |
| 5 | **Display labels** | Every event gains `resourceType` and `command` (stable code: the outbox `sourceCommand`, or the catalogued code of a request-logged route); `action` / `sourceCommand` unchanged. | `activityLabel` becomes a catalog (`features/projects/activity-labels.ts`) over the commands that can appear; unknown → resource-aware fallback ("Contract changed"), never a code. |

### 6.2 `satisfiedAt` sources

| Condition | Source | Why it is honest / why null |
|---|---|---|
| `BOQ_BASELINED` | Earliest `BoqVersion.baselinedAt` among versions currently `COMMITTED`/`BASELINED`. | `commit`/`baseline` stamp it in the same write that sets the status. |
| `ACTIVE_MAIN_CONTRACT` | Latest audit row on the effective contract with `sourceCommand` `contract.record-signed` or `contract.activate`, only while the contract is `ACTIVE`. | Transactional outbox row, written in the same transaction as the status change. Legacy contracts with no such row → null. |
| `CONTRACT_START_DATE` | The `contract.record-signed` audit row of the effective contract. | `recordSigned` always writes `startDate` and the header update can change but never clear it. A contract created through the older `contract.create` path → null (its audit rows carry no field-level evidence of when the date was set). |
| `DELIVERY_TEAM` | Start of the current uninterrupted period with more than one active member, computed from every membership's `joinedAt`/`removedAt`. | Membership rows are the member audit trail (soft-delete, never hard-deleted). |
| `CLIENT_ACTIVE` | null | Client assignment happens in `create` or the un-audited-by-field `PATCH /projects/:id`; client status changes are not time-stamped. No honest source. |
| `PROGRAMME_DATES` | null | Same: dates are set by create/PATCH with no field-level history. |

### 6.3 Activity selection (what "tied to the project reliably" means)

`AuditLog` has no `projectId`. Two kinds of row can be tied honestly:

1. **Outbox rows** (typed `resource`, `sourceCommand` set) whose `resourceId` is the project or a record the project owns — the same technique the commercial overview feed already uses:
   `Project` (id) — always; `Contract`, `ContractPaymentPlan`, `ContractRetentionTerms` (contract ids), `ContractPaymentInstallment`, `ContractAdvanceTerm`, `ContractDeliverable`, `ContractGuarantee`, `ContractMilestone` (child ids), `VariationOrder` (variation ids of the project's contracts) — only with `view:contract`; `ProjectDocument` / `ProjectDocumentRevision` (the project's documents) and `ProgrammeBaseline` — `view:project`.
2. **Request-logged rows** (`AuditInterceptor`: `resource` = route pattern, `sourceCommand` null) on routes whose `resourceId` is the project **and that have no outbox row** (so nothing is shown twice): project edit and member add/remove/role change (`view:project`); BOQ create/import/draft/commit/baseline/cancel/contingency draw (`view:boq`); programme milestones/targets/template, work packages, delivery plan, progress report creation and snapshots (`view:project`). BOQ line edits are left out on purpose (one row per cell edit drowns the feed); DPR submit/approve are not tieable (their routes carry no project id).

Left out: IPA/IPC/invoices/receipts, procurement and cost budgets — money-bearing families with their own feeds and permissions.

### 6.4 What shipped

| Area | Files |
|---|---|
| Contract | `packages/types/src/construction.ts` — `ProjectReadinessConditionResponse.blockedBy/satisfiedAt`, `ProjectReadinessCallerResponse`, `ProjectReadinessResponse.caller`, `ProjectActivityEventResponse`, `ProjectActivityPageResponse`; `recentActivity` now typed as `ProjectActivityEventResponse[]`. |
| Pure policy | `projects/domain/project-readiness.policy.ts` — `READINESS_DEPENDENCIES`, `ReadinessEvidence`, `teamFormedAt`, `CallerAuthority`, `evaluateCaller`; `evaluateReadiness(snapshot, command, authority?)` (fail-closed default); `planEnforcement` accepts `Pick<…,'conditions'>`. `projects/domain/project-activity.ts` (new) — families + permission gates, outbox resource types, request-logged route catalog, row description, limit/cursor parsing. |
| Repository | `project-prisma.repository.ts` — readiness include adds `baselinedAt`, contract `id`, every membership row with `joinedAt/removedAt`; `findContractSignatureEvents`; `findProjectActivity` (replaces `findRecentProjectActivity`). |
| Service / controller | `project.service.ts` — `getReadiness` loads evidence and passes caller authority; the apex rule is one helper shared with `enforceReadiness`; `getActivity`; `recentActivity` = first 5 of the same stream. `projects.controller.ts` — `GET :id/activity`. |
| Web | `features/projects/readiness-caller.ts` (new, fail-closed accessor), `activity-labels.ts` (new catalog + fallback), `components/project-activity-sheet.tsx` (new Sheet with Load more), `project-readiness.tsx` (waiting + doneAt), `project-actions-panel.tsx` (`caller.canRun`, `showPrimary`), `project-transition-dialog.tsx` (`caller.waivableConditions`), `project-detail.tsx` (catalog labels, View all opens the sheet), `api/projects-api.ts` (`getProjectActivity`), `hooks/use-project.ts` (`useProjectActivity`, infinite). `messages/en/platform.json` — new `projects.activity` namespace; the twelve `projects.detail.activity*` keys it replaces removed. |
| Docs | `docs/reference/api-reference.md` §6.7, ADR-019 "Amendment 2026-09-28". |

Behaviour notes:
- Money-blind readers lose nothing they had: the previous `recentActivity` showed only `Project` rows to every member; it still does, except project-level `commercial.*` rows now need `view:contract` (stricter).
- `caller` is computed for any readiness command; apex is only ever true for `start`.
- `showPrimary={false}` also skips the readiness fetch (nothing on that tab can use it).

### 6.5 Verification

- `apps/api`: `npx jest src/business/construction/projects` — 4 suites, 86 tests passed (policy, caller/dependency/`satisfiedAt`/`teamFormedAt`, activity rules, service). Live DB (`DATABASE_URL` → local Postgres, reachable): `npx jest src/business/construction/projects/__tests__/project-activity.db.spec.ts` — 4 passed (selection, permission gating, keyset split on equal timestamps, readiness evidence). A read-only check of the local `audit_logs` confirmed the interceptor stores routes as `/api/v1/projects/:projectId/boq/...`.
- `npx tsc --noEmit -p apps/api` — clean. `apps/web` typecheck via a scratch tsconfig excluding `.next` and the in-progress `features/boq/**/*.test.tsx` — clean.
- `apps/web`: `npx vitest run src/features/projects` — 13 files, 157 tests passed; plus `activity-labels.test.ts`, `src/i18n`, `components/layout/project-workspace-shell.test.tsx` — passed.
- ESLint on every changed file (web + `apps/api/src/business/construction/projects`) — 0 problems.
- Not verified: the running app in a browser; the Sheet was exercised in jsdom only.
