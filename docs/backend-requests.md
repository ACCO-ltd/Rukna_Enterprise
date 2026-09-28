# Backend requests — Progress redesign

What the Progress tab redesign asked of the backend, and where each ask stands. Status as of
2026-09-28 (branch `feat/progress-backend`). Contract details are in
[`reference/api-reference.md` §6.35](reference/api-reference.md#635-progress--programme--progress-redesign-backend-2026-09-28);
the domain rules are in the ADR-021 amendment dated 2026-09-28.

The older CEO memos and frontend-blocker lists live in [`backend-requests/`](backend-requests/).

| # | Ask | Status | Notes |
|---|---|---|---|
| 1 | Returned DPR + the reason it was returned | **Already existed** | `POST /progress/reports/:dprId/return` with `{ reason }` moves SUBMITTED → RETURNED and stores `returnReason`; the report read models carry it. Nothing new built. |
| 2 | Milestone "ready to verify" | **Done** | Milestones link to work packages (`ProgrammeMilestoneWorkPackage`, migration `20260928100000_programme_milestone_work_packages`). `POST …/programme/milestones` accepts `workPackageIds`; `PUT …/programme/milestones/:milestoneId/work-packages` replaces the set. The milestone list returns `workPackages[]` (with verified %) and a server-computed `readyToVerify`. No separate filter endpoint — the flag is on the existing list. |
| 3 | Per-user "my DPRs" + a review count | **Not built** | The frontend derives both from the full `GET /projects/:projectId/progress/reports` list (filter by `preparedBy`, count `SUBMITTED`). Fine at today's volumes; revisit with a server filter/count if a project's report list grows large. |
| 4 | Per-view capability flags | **Not built** | The frontend gates views on the same permission keys the route guards enforce: `record:progress`, `approve:progress`, `manage:project`, `approve:project`. Money visibility is the exception — it is decided server-side and signalled in the payload (see 5). |
| 5a | Over-quantity check at submit | **Done** | Submit and approve both return 400 `DPR_EXCEEDS_BOQ_QUANTITY` with `details.lines[]` and a message naming the first line. |
| 5b | Money redaction | **Done** | `progress/signal` (`actualCost`, `budgetTotal`), `progress/collection-signal` (`contractValue`, `receivedRevenue`) and milestone `releases[].amount` are `null` for callers without the BOQ money tier; both signals carry `moneyVisible`. |
| 5c | Re-baseline cites an adopted variation | **Done** | Only a `CLIENT_APPROVED` variation on this project's contract is accepted; otherwise 400. |
| 5d | Work-package allocation race | **Done** | A duplicate leaf allocation (including a concurrent one) is 409 `BOQ_ITEM_ALREADY_ALLOCATED`. |
