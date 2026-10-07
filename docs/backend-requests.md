# Dashboard (GET /dashboard) — 2026-10-06

What the Dashboard rebuild (design-system P30–P32, contract `packages/types/src/dashboard.ts`)
asked of the backend, and where each ask stands (branch `feat/dashboard-rebuild`). Endpoint
details: [`reference/api-reference.md` §6.36](reference/api-reference.md#636-dashboard--get-dashboard-2026-10-06).
Every figure is read through the module that already owns it; the dashboard adds no formula.

| # | Ask | Status | Notes |
|---|---|---|---|
| D1 | Stage NEW / PREPARATION / RUNNING | **Done** | Decided on the organisation's project statuses (not the caller's). |
| D2 | Money gate | **Done** | The Finance portfolio's exact rule: `view-margin:boq` tier + `view:financial-position`. Hidden money is `null`; `figures` is `null`. |
| D3 | To do: overdue invoices | **Done** | POSTED, balance > 0, `daysPastDue > 0` (the D5 rule). Most days late first, max 5. Money-visible callers only. |
| D4 | To do: stages ready to bill | **Done** | The portfolio's "to bill" rule (`readyStageToBill`, now shared) plus the prepare command's own guard `stagePrepareBlock` (contract ACTIVE, then CONST-COM-011); `STAGE_ALREADY_INVOICED` is ignored only for a stage whose draft is already prepared. A reopened contract gives no row. `manage:receivable`. Max 5. |
| D5 | To do: material requests awaiting approval | **Done** | SUBMITTED, not requested by the caller; `approve:material-request` **and** `view:procurement` (the request page's gate). A member-scoped approver sees only their projects' requests. The approve route itself is a separate PR. |
| D6 | To do: bill match exceptions | **Done** | `matchStatus = EXCEPTION`, unposted, not rejected/cancelled; `manage:payable`. |
| D7 | To do: bills awaiting approval | **Partial** | SUBMITTED bills, as a count + per-currency total + oldest (bounded queries). No creator exclusion — `SupplierBillService.approve` has no creator rule. "Submitted at" is the bill's `updatedAt` (a bill records no submitter or submit time; a submitted bill cannot be edited). The bills list has no status filter in its URL yet, so the row links to the full list. |
| D8 | To do: accounting setup incomplete | **Done** | The guide's own setup cycle (`AccountingGuideService.getSetupCycle`, extracted from `getGuide`); `view:accounting`. |
| D9 | To do: reports to review | **Done** | SUBMITTED DPRs grouped per project in one query; `approve:progress`. |
| D10 | To do: milestones ready to verify | **Done** | `ProgrammeService.listMilestones` `readyToVerify`, in-progress projects only; `manage:project`. Links to Progress → Review, where Verify lives. |
| D11 | To do: project ready to start / projects without contract | **Done** | Start readiness (`evaluateReadiness('start')`); "without contract" = the `ACTIVE_MAIN_CONTRACT` condition unmet on a CLIENT_CONTRACT draft. The projects list has no status filter in its URL yet. |
| D12 | Figures: contract value in progress, receivables, payables | **Done** | Per currency, and only for a currency with something active (ACTIVE project, counted in its contract's currency) or invoiced (unpaid posted invoice) — never a strip of zeros; payables in a currency with neither are therefore not shown. Receivables org-wide for `ALL` scope (incl. invoices with no project), the caller's projects for `MINE`; folded by `computeReceivablePosition`. Payables via the portfolio's bills-to-pay rule (`findOpenPostedBills`). |
| D13 | Receivables aging | **Done** | Bucket rule moved to `commercial/domain/receivable-aging.ts`, shared with the Commercial billing read model; 61–90 and 90+ fold into `over60`. |
| D14 | Progress per started project | **Done** | `ProgressService.getScheduleReading`: the schedule-variance planned % and roll-up physical %; null (not 0) with no plan / no work package. Read for the 25 most recently updated started projects, 4 at a time (milestone lists likewise); rows beyond the cap get null percentages. A per-project failure gives nulls and is logged (warn). |
| D15 | Preparation readiness + next step + value | **Done** | One batched snapshot query (`findReadinessSnapshots`); next step in `PREPARATION_STEP_ORDER`. Value = executed main contract, else the creation estimate. |
| D16 | Activity | **Done** | Newest 5 across the caller's 10 most recently updated open projects; same stream and gates as `GET /projects/:id/activity`; no amounts. |
| D17 | Setup checklist (stage NEW) | **Done** | Client, project, accounting (ledger ready), suppliers + catalogue material (optional; `manage:payable`), team (> 1 active user). |
| D18 | Approvals assigned to a specific approver | **Not built** | `ApprovalInstance` has no assignee. Bill and material-request approvals are shown to everyone holding the approve permission, minus their own. |
| D19 | Purchase-order approvals | **Not built** | Purchase orders have no approval step to wait on. |
| D20 | One organisation base currency | **Not built** | The organisation has no base currency; figures are returned per currency and never added across currencies. |

# Backend requests — Progress redesign

What the Progress tab redesign asked of the backend, and where each ask stands. Status as of
2026-09-28 (branch `feat/progress-backend`). Contract details are in
[`reference/api-reference.md` §6.35](reference/api-reference.md#635-progress--programme--progress-redesign-backend-2026-09-28);
the domain rules are in the ADR-021 amendment dated 2026-09-28.

The older CEO memos and frontend-blocker lists live in [`backend-requests/`](backend-requests/).

| # | Ask | Status | Notes |
|---|---|---|---|
| 1 | Returned DPR + the reason it was returned | **Existed; extended** | `POST /progress/reports/:dprId/return` with `{ reason }` moves SUBMITTED → RETURNED and stores `returnReason`. Now also records `returnedBy` / `returnedAt` (migration `20260928110000_dpr_returned_by`) and the read models add `returnedByName`. |
| 2 | Milestone "ready to verify" | **Done** | Milestones link to work packages (`ProgrammeMilestoneWorkPackage`, migration `20260928100000_programme_milestone_work_packages`). `POST …/programme/milestones` accepts `workPackageIds`; `PUT …/programme/milestones/:milestoneId/work-packages` replaces the set. The milestone list returns `workPackages[]` (with verified %) and a server-computed `readyToVerify`. No separate filter endpoint — the flag is on the existing list. |
| 3 | Per-user "my DPRs" + a review count | **Not built** | The frontend derives both from the full `GET /projects/:projectId/progress/reports` list (filter by `preparedBy`, count `SUBMITTED`). Fine at today's volumes; revisit with a server filter/count if a project's report list grows large. |
| 4 | Per-view capability flags | **Not built** | The frontend gates views on the same permission keys the route guards enforce: `record:progress`, `approve:progress`, `manage:project`, `approve:project`. Money visibility is the exception — it is decided server-side and signalled in the payload (see 5). |
| 5a | Over-quantity check at submit | **Done** | Submit and approve both return 400 `DPR_EXCEEDS_BOQ_QUANTITY` with `details.lines[]` and a message naming the first line. |
| 5b | Money redaction | **Done** | `progress/signal` (`actualCost`, `budgetTotal`), `progress/collection-signal` (`contractValue`, `receivedRevenue`) and milestone `releases[].amount` are `null` for callers without the BOQ money tier; both signals carry `moneyVisible`. |
| 5b-2 | Hide money-derived percentages (owner decision 2026-09-29) | **Done** | Without the cost tier, `progress/signal` also nulls `costConsumedPercent` and `divergence` with `status: 'HIDDEN'` (the curve's `actual[].costPercent` and a snapshot capture's response too; stored snapshots keep the true value). Without the margin tier or `view:contract` (`canViewContractFigures`, so the Construction Director sees them), `progress/collection-signal` nulls `collectedPercent` and `divergence` (`status: 'HIDDEN'`) and milestone `releases[].percentage` is null. Physical / verified % stay. |
| 5c | Re-baseline cites an adopted variation | **Done** | Only a `CLIENT_APPROVED` variation on this project's contract is accepted; otherwise 400. |
| 5d | Work-package allocation race | **Done** | A duplicate leaf allocation (including a concurrent one) is 409 `BOQ_ITEM_ALREADY_ALLOCATED`. |
| 6 | DPR list shows the work packages a report touches, and who approved / reviewed it | **Done** | List and detail add `workPackages[] {id, code, name}`, `approvedByName` and `reviewedByName` (approver for APPROVED, reopener for REOPENED, returner for RETURNED), all batched — no per-report queries. |
| 7 | Fix a typo in a draft work entry | **Done** | `DELETE /progress/reports/:dprId/measurements/:measurementId` while DRAFT / RETURNED / REOPENED (409 otherwise). In a REOPENED report only entries added since the reopen can be deleted (approved entries are superseded, not overwritten — migration `20260928120000_progress_measurement_created_at` adds `created_at`). Tagged evidence is detached, not deleted. **2026-09-29:** the DPR response exposes `reopenedAt` / `reopenedBy` / `reopenedByName` and each work entry's `createdAt`, so the editor offers Remove on a REOPENED report only for entries created after the reopen. |
| 7a | Backfill side effect of `created_at` | **Known, accepted** | The migration backfills existing work entries with their report's `created_at`. For a report that is **already REOPENED** when the migration runs, any correction entries added after that reopen also get the report's (earlier) date, so they read as "before the reopen" and become undeletable until the report is re-approved. Only reports reopened before the deploy are affected; entries added after the deploy are dated correctly. Workaround: re-approve and, if needed, reopen again. |
| 7b | Write paths vs concurrent submit / approve | **Done** | Every DPR add / edit / delete (work entries, labour, equipment, observations, context, evidence) runs under the report's row lock with a fresh status re-check, inside a 15 s transaction. Lock timeout / deadlock → 409 `DPR_CHANGED` ("busy — try again"). Evidence can be added while DRAFT / RETURNED / REOPENED **and SUBMITTED** (the UI lets photos be added during review); it is refused (409) once APPROVED. |
| 8 | DPR document number | **Not built (by decision)** | Reports are identified by project + date; no number is added. |

## Open question for the owner: may a scope-only editor delete a priced BOQ line? (2026-09-29)

PR #241 (ADR-029 §8 A-1) stops an `edit-scope:boq`-only editor (no `edit-cost:boq`, no `manage:boq`)
from changing a line's unit rate, pricing basis, lump-sum amount, or flipping a priced item to a
section. `DELETE …/boq/versions/:vid/nodes/:id` is unchanged: a scope-only editor can still delete
a priced draft line, which removes its amount from the BOQ total.

Left as it is on purpose — deleting scope is arguably a scope decision, and a guard here would also
block tidying an imported bill. **Decision needed (Eng Ahmed / owner):** should deleting a line that
carries a rate or amount require the cost-edit permission too?

## Decided 2026-09-29 (owner): no value-based weights for money-blind callers

Even package-level weights can be probed — put one leaf in a package on its own and its weight is
that leaf's share of the BOQ value. So a caller without the BOQ cost tier gets an **even split**
(across packages holding measurable, non-contingency scope; weights still sum to 1) from both
`POST …/work-packages/delivery-plan/weights` and `POST …/programme/suggest-weights`, flagged
`valueWeighted: false`. Cost-tier callers keep value weighting (`valueWeighted: true`). The unpriced
leaf ids are still returned, since `priced` is visible to every tier. The Delivery Plan, the work
packages section and the schedule wizard show one quiet note: "Weights are split evenly. Value-based
weighting needs cost access — adjust the weights, or ask the Construction Director."


---

# Backend requests — Procurement refine (2026-10-04)

Branch `feat/procurement-refine`. Asked by the procurement UI refine; all API-only (no migration).
Money on the new list fields is `null` unless the caller holds `view:commitment-ledger` (cost
visibility — the gate the PO money reads already use, ADR-043 decision 4); rows carry
`moneyVisible`. List endpoints still return arrays, and every previous row field is kept.

| # | Ask | Status | Contract |
|---|---|---|---|
| 1 | PO confirm through governance | **Done** | `POST /procurement/purchase-orders/:id/confirm` evaluates the seeded `PurchaseOrder DRAFT→SUBMITTED` binding with the draft revision total. Gated → 409 `{ error.details.approvalInstanceId }`, nothing written; pending → same id; once APPROVED, calling confirm again consumes it and confirms, writing `revision.approvalInstanceId` and `approvedBy` = the final approver (else the confirmer). Cancel closes an open approval; attaching evidence to the draft voids an unconsumed grant. No binding → confirms as before. |
| 2 | Material request approval | **Done** | Submit is gated (`MaterialRequest DRAFT→SUBMITTED`, amount = Σ qty × estimatedUnitPrice, null when unpriced) — 409 + `approvalInstanceId` like the PO. `POST /procurement/material-requests/:id/approve` (SUBMITTED→APPROVED) and `POST …/:id/reject` `{ reason }` (SUBMITTED→DRAFT, reason on the audit trail), both `approve:material-request`. Approve enforces `REQUESTER_CANNOT_APPROVE_OWN_REQUEST` (403, `details.code`). |
| 3 | Server-set MR requested date | **Done** | `requestedDate` is optional and ignored on create; the server stamps today (UTC calendar day). |
| 4a | Receivable POs | **Done** | `GET /procurement/purchase-orders/receivable` (`view:procurement` + `create:goods-receipt`) → `[{ id, poNumber, status:'OPEN', supplier{id,name}, activeRevisionId, activeRevisionNumber, expectedDeliveryDate, projects[{id,code,name}], lines[{ purchaseOrderLineId, lineNumber, description, uomCode, uomSymbol, orderedQuantity, acceptedQuantity, remainingQuantity }], canReceive, blockedReason: 'PO_CREATOR_CANNOT_RECEIVE_GOODS'|null, receiptException: {id,status}|null }]`. Only POs with remaining quantity (ordered − accepted on POSTED GRNs); project-scoped; no prices. |
| 4b | GRN rules | **Done** | SoD re-checked on post. Every SoD 403 now carries `error.details.code` = the rule code (message unchanged). `rejectionReason` required when `rejectedQuantity > 0` (400). Over-receipt policy unchanged. |
| 5a | PO list | **Done** | `GET /procurement/purchase-orders?status&supplierId&projectId&search` adds `project`, `projectCount`, `total`, `currencyCode`, `deliveryStatus` (NOT_RECEIVED/PARTLY_RECEIVED/RECEIVED; null for DRAFT/CANCELLED), `activeRevisionNumber`, `revisionStatus`, `moneyVisible`. Project-scoped (org-level POs visible to all). |
| 5b | MR list | **Done** | `GET /procurement/material-requests?…&requestedFor=<projectId>|overhead&search` adds `estimatedTotal`, `requester{id,name}`, `project`, `moneyVisible`. `scope` / `projectId` still work. |
| 5c | GRN list | **Done** | `GET /procurement/goods-receipts?purchaseOrderId&status&search` adds `supplier{id,name}`, `purchaseOrder{id,number}`, `project`, `projectCount`, `deliveredBy{id,name}` (the user who recorded it). Project-scoped. |
| 5d | Supplier directory | **Done** | `GET /procurement/suppliers?status=ACTIVE|INACTIVE|ALL&search` (`view:procurement`) → `{ id, code, name, status, primaryContact{name,phone}|null, paymentTermsDays, defaultCurrency, openOrderCount, payableBalance, payableBalances[{currencyCode,amount}], moneyVisible }`. Supplier has no type field — none returned. `POST /suppliers/:id/deactivate` / `reactivate` (`manage:payable`, audited, 409 on a no-op). |
| 5e | Catalogue status | **Done** | `GET /procurement/{materials,material-categories,spend-categories,uom}?status=ACTIVE|INACTIVE|ALL` (default ACTIVE). `POST …/:id/reactivate` on all four, audited; deactivate/discontinue are now audited too and 409 when already inactive. |
| 5f | Buyer advances | **Done** | `GET /buyer-advances` without `purchaseOrderId` lists org-wide, newest first (`limit`, default 100, max 500); rows add `purchaseOrder{id,poNumber}` and `supplier{id,name}`. |
| 5g | Commitment entries | **Done** | `GET /procurement/commitment-ledger/projects/:projectId` and `/purchase-orders/:poId` rows add `documentNumber`, `supplierName`, `boqNode{id,code,name}` (batch-resolved). `GET /projects/:projectId/procurement/cost` only had the last 10 entries with a PO reference, so it was not reused. |

## Still open

- **(a) Prices reach money-blind roles.** PO / MR / GRN list *and detail* still return unit prices
  (PO lines, MR `estimatedUnitPrice`) to anyone with `view:procurement`; only the new aggregate
  fields are gated. Server-side redaction needs an Eng Ahmed / product decision, because Project
  Managers create POs and need to enter prices.
- **(b) MR line `boqNodeId` is unvalidated and not inherited by PO lines.** The MR create path
  stores any `boqNodeId`. The cost target that matters is the PO line's: PO line DTO →
  `resolveLines` → `cost-target.policy` `validateCostTarget` → confirm writes COMMITTED → GRN reads
  `poLine.boqNodeId`. Allocating an MR line to a PO line does not copy or check its node.
- **(c) Who may approve a material request?** `approve:material-request` exists but no ACCO team
  role holds it (only ADMIN, via the admin refresh). Granting it is a role decision — not done here.
- **(d) Requester ≠ approver inside the approval engine.** The workflow `ApprovalService` checks
  the step role and the system-admin rule only; it does not stop the initiator approving their own
  instance. A PO creator who holds a chain role could approve their own PO. Needs an SoD rule /
  engine change (Eng Ahmed).
- **(e) MR double approval.** If an MR binding is activated, a request goes through the chain on
  submit *and* still needs the explicit approve. No MR binding is seeded today.
- **(f) Band currency.** PO / MR amounts are passed to the band resolver in document currency (no
  FX to USD).
- **(g) Supplier status is not enforced.** PO create does not refuse an INACTIVE supplier.
- **(h)** `view:financial-position` still gates money on the project procurement tab, so the
  Procurement Manager sees nulls there while seeing figures on these lists.
