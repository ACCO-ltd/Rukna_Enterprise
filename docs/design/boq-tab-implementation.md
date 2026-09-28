# BOQ tab — redesign implementation note

Status: implemented 2026-09-28 (uncommitted). Frontend only; no BOQ API contract, numbering, validation, amount,
audit, library or permission change. No migrations, no new statuses.

## 1. Phase 0 — what is there

**Components** (`apps/web/src/features/boq/components/`)

| Component | Role |
|---|---|
| `boq-workspace.tsx` | Tab root. Loads workspace + tree, owns filters/collapse, drawer/dialog state, composes everything below. |
| `boq-money-strip.tsx` | Sticky band: life-stage label ("Working · draft", brand-blue), totals, contract value/contingency (tier-gated), primary + secondary actions. |
| `boq-readiness-banner.tsx` | Commit-readiness blockers with "Show these". Still worded for the retired commit ("before this BOQ can be committed"). |
| `boq-toolbar.tsx` | Search, the 7-way filter dropdown (all/incomplete/priced/sections/items/original/variations), expand/collapse, Add section, Import. |
| `boq-grid.tsx` | Real `<table role="grid">`, roving row focus, section collapse buttons (`aria-expanded`), row kebab, click-to-edit cells, pinned cells after commit, "Showing x of y rows" footer + total. |
| `boq-editable-cell.tsx` | Click-to-edit cell for description/quantity/rate; awaits the save, error ring on failure. |
| `boq-item-drawer.tsx` | A **Dialog** (not a sheet) for add/edit section or item: code, description, unit (free text), measurement method, pricing basis, qty, rate, library pick / save-to-library. |
| `boq-import-dialog.tsx` | Modal: Upload → Map → Review. Mode Select defaults to REPLACE, always shown. Preview list rendered in server order. |
| `boq-timeline-drawer.tsx`, `boq-compare-signed-panel.tsx`, `boq-classifier-drawer.tsx`, `add-extra-work-drawer.tsx`, `boq-library-picker.tsx` | Timeline, compare-to-signed lens, who-pays classifier (post-signing extra work), library picker. |

**Hooks / API** — `hooks/use-boq.ts` (`boqKeys`, `useBoqWorkspace`, `useBoqTree`, `useAddNode`, `useUpdateNode`, `useDeleteNode`, `useMoveNode`, `useCancelDraftVersion`, `useCreateDraftVersion`, `useBoqImportPreview`, `useImportBoq`, `useBoqTimeline`, `useBoqCompareToSigned`, `useAddExtraWork`); `api/boq-api.ts`. All mutations invalidate `['boq', projectId]` + project detail.

**Version statuses** (`BoqVersionStatus`): `DRAFT`, `BASELINED` (legacy), `COMMITTED`, `SNAPSHOT`, `SUPERSEDED`, `CANCELLED`. Registry vocabulary `boqVersion` covers all six. `moneyBand.lifeStage` is `WORKING` | `COMMITTED`.

**Commands**
- Baseline/commit: `POST …/versions/:id/commit` (`commit:boq`, `capabilities.canCommit`); `…/baseline` 308-redirects to it. **ADR-032 removed the user-facing commit**: "no user-facing Commit BOQ or Commit to contract action"; recording the signed contract takes the immutable Signed BOQ snapshot. The web client already dropped the commit call (`version-actions.ts`: "Manual baseline/commit is intentionally absent").
- Revision: `POST …/boq/draft` (needs an approved version and no open draft) — `getVersionActions().canCreateDraft`.
- Discard: `POST …/versions/:id/cancel` (`manage:boq`) — `canCancelDraft`.

**Does "Create contract" need a baselined/committed BOQ?** No. `POST /contracts/record-signed` (`create:contract` + `approve:contract`) finds the current operational version (DRAFT or COMMITTED) and snapshots it (`contract.service.ts` ~l.159–250, "No committed BOQ is required"). Unpriced items do not block it; the live BOQ and signed value may differ (ADR-032). Project readiness `BOQ_BASELINED` is satisfied by a committed/snapshot version, which the signing produces.

**Codes** — `POST …/nodes` without `code` → server assigns `parent.code + (highest sibling tail + 1)`, keeping the siblings' zero-padding; gaps from deletions are never refilled (codes are quoted in issued documents). A sent `code` is kept verbatim (collision → 400, not retried). Moves change only `sortOrder` (dense, server-reindexed); **codes are never renumbered**. A parent holds sub-sections *or* items, never both (server-enforced).

**Import pipeline** — browser parses (`boq-import-parse.ts`: xlsx first sheet or CSV, header row, cells → trimmed strings, 20 000-row cap) → `autoGuessMapping` by heading → `applyMapping` (drops fully blank rows, `rowNumber` = sheet line) → `POST …/import/preview` (server dry-run: tree, section/item counts, auto-created sections, violations, warnings incl. `UNPRICED_ITEM`, `AMOUNT_MISMATCH`, `UNKNOWN_UNIT`) → `POST …/import` (all-or-nothing, `mode: REPLACE|APPEND`, `addToLibrary`). Result: created section/item counts, library count, warnings. No undo.

**Units master** — `UnitOfMeasure` (org-scoped, ACTIVE/INACTIVE) behind `GET /procurement/uom`, which requires `procurementConfigManage`. BOQ nodes store `unit` as free text; the import only *warns* on unknown units. A QS without procurement-config rights cannot read the list.

**Money visibility** — server-side tiers (`resolveBoqVisibility`): `canViewCost` (rates, amounts, line budgets, `inContractTotal`) and `canViewMargin` (contract value, contingency, revenue). Withheld fields arrive `null`; `capabilities` says which tier the caller has. Money-blind roles (PM/SE) have neither.

**Inline vs whole-item saves** — one endpoint: `PATCH …/versions/:vid/nodes/:id` (UpdateNodeDto, all fields optional). The client currently re-sends the node's full editable field set built from the row (`toUpdateNodePayload`) on every cell commit, so a "cell save" is a whole-item save. No per-cell autosave endpoint, no optimistic concurrency token.

**Delete** — hard delete, draft only; `400` if the node has children, `409` if referenced. Nothing restores a node.

## 2. What changed

| File | Change |
|---|---|
| `packages/ui/src/components/context-bar.tsx` (**new**) | `ContextBar`: title, registry status pill, label/value metrics, ONE primary, overflow, one note line (`neutral` / `attention` / `restricted`). Generic and router-free. |
| `packages/ui/src/components/file-drop.tsx` (**new**) | `FileDrop`: drop zone plus a real "Choose file" button, chosen file with Remove, inline error, slot for a template link. |
| `features/boq/components/boq-context-bar.tsx` (**new**) | The BOQ bar on `ContextBar`. Primary: **Create contract** before signing (only with `create:contract` + `approve:contract`); **Add extra work** after signing (only with `canEdit`); otherwise none, plus a one-line reason. Kebab: Import…, Export to CSV, History, Compare to signed, Start a revision…, Discard draft… (last, destructive). |
| `features/boq/components/boq-toolbar.tsx` | Rewritten: search, `ViewSwitcher` "All lines · Unpriced (n)", Expand all / Collapse all. The 7-way dropdown and the Add section / Import buttons are gone. |
| `features/boq/components/boq-grid.tsx` | Refined, not replaced. **Edit mode** (draft + permission): boxed fields at rest (auto-growing description, unit with datalist, quantity, rate); each saves on blur/Enter with saving / failed / invalid states; "+ Add item to {code}" closes each open item-section; inline new line (focused), inline new sub-section / root section; the kebab lists only what the node can take. **Read mode** keeps the roving `role="grid"`. "No rate" (attention tone), "Lump sum", footer = BOQ total only. Under 640px unit/qty/rate hide and "180 m³ × $6.50" sits under the description; a tap opens the details sheet. Money-blind: no rate/amount columns, no total. |
| `features/boq/components/boq-cell-editor.tsx` (**new**) | The boxed field; replaces `boq-editable-cell.tsx`. |
| `features/boq/components/boq-import-view.tsx` (**new**) | Import as a page inside the tab (view state): back link, read-only `LifecycleStepper` (Upload · Match columns · Review), `FileDrop`, mapping table (field / column / first-row value, inline required errors), review (counts + total, one attention notice, errors notice, Add/Replace radio cards only when the draft has lines — default Add — library checkbox, preview as the read-only grid in true hierarchy), sticky bar with ONE primary (hidden, not disabled, when the dry-run has errors). Replaces `boq-import-dialog.tsx`. |
| `features/boq/boq-import-preview.ts` (**new**) | Rebuilds the preview hierarchy from `parentCode` (fixes the level-by-level order). |
| `features/boq/boq-rows.ts` | `withAddRows`, `acceptsItems` / `acceptsSections`, `siblingBounds`, `countDescendants`. |
| `features/boq/components/boq-item-drawer.tsx` | Now a side `Sheet` ("Edit details…", "Add from library…"); fields and payloads unchanged. |
| `features/boq/components/boq-workspace.tsx` | Rewired around the above; empty state (import primary, blank secondary, template link; read-only copy); success notice after import; Delete and Discard via `ConfirmActionDialog`. |
| `components/layout/project-workspace-shell.tsx` | Header passes `showPrimary` only on Overview — one primary per screen. |
| Deleted | `boq-money-strip.tsx` (+test), `boq-readiness-banner.tsx`, `boq-editable-cell.tsx` (+test), `boq-import-dialog.tsx`. |
| `messages/en/platform.json` | `boq.contextBar`, new grid / toolbar / import keys. |

## 3. Design ↔ code conflicts and decisions

| # | Design | Code / domain | Decision |
|---|---|---|---|
| 1 | Draft fully priced → primary "Baseline BOQ version N?"; unpriced → no primary, "Baselining needs every item priced". | ADR-032: no user-facing commit/baseline; recording the signed contract snapshots the live BOQ; unpriced lines do not block it. | No baseline command anywhere. Before signing the primary is **Create contract**; unpriced lines get an attention note + "Show unpriced", worded honestly ("n items aren't fully priced"). |
| 2 | "Baselined (read-only)" view with Create contract. | After signing the live version stays DRAFT; the next step is the who-pays decision. | Signed: pill shows the version's own status, a "Signed {date}" metric (snapshot date), a note explains the snapshot, primary **Add extra work**, no Discard. Legacy COMMITTED versions keep pinned value cells. |
| 3 | Unit is a Select from the Units master. | `GET /procurement/uom` needs `manage:procurement-config`; `unit` is free text on nodes. | Text input with a datalist: master units (when readable) + units already in the bill. |
| 4 | Section 1 holds items **and** sub-section 1.3. | The server forbids mixing items and sub-sections under one parent. | "+ Add item" only under sections without sub-sections; "Add sub-section" only under sections without items. |
| 5 | Delete with "Deleted … and n lines under it. Undo". | Hard delete; 400 when the node has children; nothing restores. | `ConfirmActionDialog` ("This can't be undone."); a section with lines has no Delete in its menu. |
| 6 | Moves renumber auto codes. | Codes are never renumbered; only `sortOrder` moves. | Moves call the existing endpoint; codes stay. |
| 7 | "Export to Excel". | Export writes CSV. | Labelled "Export to CSV". |
| 8 | "Undo import". | No import rollback. | Success notice without Undo. |
| 9 | Pill "Draft" instead of "Working · draft". | Registry `boqVersion`. | Pill word from the registry vocabulary (DRAFT → "Draft"). |
| 10 | Lump sum shows "Lump sum" in the quantity column. | Amount is still qty × rate; no server rule for lump sums. | "Lump sum" only when `pricingBasis = LUMP_SUM` and qty is 1 or empty. A lump sum without a unit still counts as not fully priced (existing `isPriced`, unchanged). |

## 4. Needs backend support

1. Undo for delete (soft delete / restore) and for an import (import batch rollback).
2. Deleting a section together with its lines (today: children first).
3. A Units read endpoint available to BOQ editors (`view:boq` / `manage:boq`), not only procurement config.
4. Per-field PATCH with a version/etag so two editors' cell saves cannot overwrite each other (today each cell save re-sends the row's editable fields).
5. Mixed sections (items and sub-sections under one parent), if the design's shape is wanted.
6. Workspace guidance still says "main contract blocked until the BOQ is baselined" (`project.service.ts`, workspace-guidance), contradicting ADR-032. The BOQ tab no longer reads it.
7. An xlsx export (today CSV).

## 5. Verification

- `apps/web` full suite: **224 files, 2528 tests passed**. New or rewritten BOQ tests:
  - `boq-grid.test.tsx` — edit / save / failed / invalid, add-item focus, Escape abandons a new line, menu options per node, Tab order through toggles, cells and kebabs, money-blind columns removed, No rate / Lump sum;
  - `boq-context-bar.test.tsx` — never a baseline step, unpriced note → Show unpriced, no disabled primary, signed state, overflow order, money-blind note;
  - `boq-import-view.test.tsx` — review tree order, Add by default, Replace/Append sent to preview and import, no mode question on an empty draft, Import hidden on errors;
  - `boq-import-preview.test.ts`, `boq-rows.test.ts` (unpriced + search keep parents, add-line placement, sibling bounds);
  - shell test: no header primary on BOQ / Progress / Commercial / Documents.
- Typecheck: web (excluding generated `.next`) and api clean. ESLint: 0 errors on every changed BOQ file (3 pre-existing warnings in the untouched classifier drawer).
- API: `jest src/business/construction/projects src/business/construction/boq` — 22 suites, 278 passed.
- Visual (Playwright against the local dev server, every API call stubbed): empty (editor, read-only), draft with unpriced, draft fully priced, signed, money-blind × 1440 / 1024 / 768 / 375 × light / dark, plus Upload / Match columns / Review at 1440 and 375 in both themes — 52 captures. Automated per capture: no horizontal page overflow, no header primary, no baseline/commit control, no `$0.00`, no page errors, no rate column for money-blind. Reviewed by eye.
- Not verified: a real import / edit round-trip against the live API (stubbed only); contrast only by eye.
- Found in passing: `globals.css` gives `<button>` an unlayered `font: inherit`, which silently beats Tailwind text-size utilities on buttons — worth a design-system fix.
