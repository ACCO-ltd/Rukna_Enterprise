# Rukna — Capability Matrix (Implementation Truth Map)

**This is the single source of truth for implementation status.** When any other document
(roadmap, domain-model, ADRs, architecture SAD) disagrees with this file about whether
something is built, **this file wins** and the other document is stale — fix it.

Last verified against code: **2026-08-14** (branch `main`). Verified from the Prisma schema
(`apps/api/prisma/schema.prisma`), NestJS module/controller registration
(`apps/api/src/**`), and Next.js routes (`apps/web/src/app/**`).

## Status legend

| Status | Meaning |
|---|---|
| `NOT_DESIGNED` | No design and no code. |
| `DESIGNED` | An ADR / spec exists; no code. |
| `BACKEND` | Backend implemented (models + service + controller + tests), no UI. |
| `INTEGRATED` | Backend **and** frontend implemented and wired end-to-end. |
| `PARTIAL` | Some of the capability exists; scope is incomplete (see note). |
| `BLOCKED` | Cannot proceed — waiting on a decision or dependency. |

---

## Platform (cross-cutting)

| Capability | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Identity / Auth (JWT + refresh rotation) | ✓ | ✓ | INTEGRATED | HttpOnly refresh cookie, jti rotation, reuse detection. `platform/auth` |
| Multi-tenancy (DB-per-tenant) | ✓ | ✓ | INTEGRATED | Subdomain → tenant, LRU client cache. `platform/tenancy` |
| Organizations / Membership | ✓ | ✓ | INTEGRATED | Membership validated on every request. |
| RBAC (roles / permissions) | ✓ | ✓ | INTEGRATED | Global `PermissionsGuard`, `@RequirePermissions`, JWT carries permissions. |
| Workflow / DOA engine | ✓ | ✓ (admin) | PARTIAL | Engine + `CommandGovernanceService` seam + loop-back (ADR-011/015) done. **Value-threshold routing + SoD now CONFIRMED REQUIRED — complete, do not delete (ADR-022).** ACCO thresholds/SoD/approval chains signed off 2026-08-17; `SegregationOfDutiesService` + `WorkflowStep` + per-command threshold ladders to be wired. |
| Audit (transactional outbox) | ✓ | ✓ (view) | INTEGRATED | `AuditLog` + `AuditOutboxEvent` in the same tx as the mutation (ADR-008), all 7 business modules. |
| Exchange rates | ✓ | — | BACKEND | `ExchangeRate` model + resolution. |
| Notifications (delivery) | — | — | NOT_DESIGNED | Only `notification-event.policy.ts` domain stub. No persistence, no delivery, no UI. |
| Files / document storage | ✓ | ✓ | INTEGRATED | ADR-014 (`PlatformFile`): `FileStoragePort` + MinIO adapter, presigned PUT/GET (15-min TTL), tenant-partitioned keys, immutable-where-audit-relevant. `platform/files` |
| Document register / revisions / transmittals | ✓ | ✓ | PARTIAL | Standalone project **document register** (`ProjectDocument`: category + title on a PlatformFile) + Documents tab shipped. **Linked-documents aggregation (files attached to contracts/IPAs/IPCs/guarantees/DPRs) DEFERRED** — see `documents-tab-refinement-spec.md` §2. Revisions/transmittals still out of scope. |

---

## Construction — Scope & Delivery

| Capability | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Projects (lifecycle, suspend/resume, members) | ✓ | ✓ | INTEGRATED | 8-state lifecycle. `construction/projects` |
| BOQ (versioning, tree, baseline) | ✓ | ✓ | INTEGRATED | DRAFT→BASELINED→SUPERSEDED, materialized path. ADR-016 workspace. |
| BOQ Item Library (reusable work items) | ✓ | (UI: Round-2) | BACKEND | ADR-020 CONST-BOQ-020/021: org-level `BoqItemLibrary` (search / save-to-library / record-usage), distinct from the Material catalogue. No authoritative rate — `lastUsedRate` as assistance only. Fast-entry UI + capability roles (CONST-BOQ-022) + variation router (CONST-BOQ-025, blocked #51) remain. |
| Programme / Schedule / Activities | — | — | NOT_DESIGNED | **Biggest construction gap.** No time/schedule domain. |
| Physical Progress / Measurement | ✓ | ✓ | PARTIAL | ADR-021 MVP: DPR lifecycle → verified progress (approved-DPR provenance, cumulative ≤ BOQ scope), work-package weighted roll-up (one-leaf-one-package, CONST-PROG-012), physical-vs-financial + collection-vs-progress signals, IPA pre-fill. **Time domain:** Phase 1 (CONST-PROG-011) planned `ProgressTarget[]` curve → planned-vs-verified **schedule-variance** signal; Phase 2 (CONST-PROG-005) **programme activities** (`ProgrammeActivity` under WorkPackage — dates/duration/milestone); Phase 3 (CONST-PROG-010) **controlled reopen/correction** (APPROVED→REOPENED with `reopenedBy/At/Reason` audit trail; editable + re-submittable; drops out of verified roll-up until re-approval). Deferred: dependency network, Excel/P6 import. `construction/progress` |

---

## Construction — Client Commercial (Revenue, Flow A)

| Capability | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Contracts (retention, advances, guarantees, milestones) | ✓ | ✓ | INTEGRATED | 8-state lifecycle, client snapshot on execute. |
| IPA (Interim Payment Application) | ✓ | ✓ | INTEGRATED | Items + deductions, effective-certified resolution. |
| IPC (Interim Payment Certificate) | ✓ | ✓ | INTEGRATED | Atomic supersession, variance reason. |
| Commercial workspace (4-section) | ✓ | ✓ | PARTIAL | ADR-017. Guided through AR invoice; posted settlement is read-only. CustomerReceipt create/allocation blocked on A12. en/ar + RTL. |
| Milestone payment schedule + installment invoicing (ADR-023) | ✓ | ✓ | INTEGRATED | MILESTONE contract billed from its payment plan: the plan is defined on the contract-create form (percentages reconcile to 100%), then per-installment status, generate-invoice-from-installment, and programme-milestone link in the commercial workspace. CONST-COM-011 evidence gate closed both sides (invoicing blocked until the linked milestone is VERIFIED). en/ar placeholders (Arabic paused). Browser-verified 2026-08-20. |
| Variations / Change Orders | — | — | DESIGNED | `BoqNode.sourceType`/`sourceChangeOrderId` provenance prepared; no ChangeOrder aggregate. BLOCKED on #51 (Eng Ahmed). |

---

## Finance & Accounting (Flow C)

| Capability | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Chart of Accounts + fiscal calendar | ✓ | ✓ | INTEGRATED | Account/period versions, control accounts. |
| Double-entry posting engine | ✓ | — | BACKEND | `AccountingPostingService`; ∑Dr=∑Cr enforced. |
| Manual Journals | ✓ | ✓ | INTEGRATED | DRAFT→…→POSTED→REVERSED, four-eyes. |
| Accounts Receivable (invoice from IPC, receipts) | ✓ | ✓ | INTEGRATED | Invoices + customer receipts + allocation. |
| Accounts Payable (supplier bill, payment) | ✓ | ✓ | INTEGRATED | Bill create/submit/approve/post/reverse; NON_RECOVERABLE VAT. |
| General Ledger (trial balance, P&L, balance sheet) | ✓ | ✓ | INTEGRATED | Ledger, TB, P&L, BS, period lock/close/year-end. |
| Payment receipts + allocation (construction billing) | ✓ | ✓ | INTEGRATED | `/receipts`. |
| Opening balances / migration | ✓ | ✓ | INTEGRATED | TB import + open AR/AP. |
| Cash & Banking | ✓ | ✓ | PARTIAL | Bank accounts + `accounting/reconcile`. Full bank reconciliation is basic. |
| Tax | ✓ | — | PARTIAL | `TaxCode`/`TaxPolicy` + NON_RECOVERABLE VAT posting; broader tax handling incomplete. |
| Project Actual P&L (posted GL only) | ✓ | ✓ | INTEGRATED | ADR-013. `GET /projects/:id/pl`, page `/projects/[id]/pl`. |
| Project Financial Position (actual + commitments + forecast) | ✓ | — | BACKEND | ADR-013. `GET /projects/:id/financial-position`, `ProjectFinancialPositionController/Service`. **No UI yet.** |
| Period close | ✓ | ✓ | INTEGRATED | Lock/close/reopen/snapshot/year-end. |

---

## Procurement & Cost (Flow B)

| Capability | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Catalogue (UoM, MaterialCategory, SpendCategory, Material) | ✓ | ✓ | INTEGRATED | `procurement/catalogue`, setup pages. |
| Suppliers | ✓ | ✓ | INTEGRATED | |
| Material Requests (dual-scope, DOA) | ✓ | ✓ | INTEGRATED | PROJECT \| ORGANIZATION. |
| Purchase Orders (immutable revisions, MR↔PO allocation) | ✓ | ✓ | INTEGRATED | |
| Goods Receipts (accept/reject, over-receipt tolerance) | ✓ | ✓ | INTEGRATED | `EXCEPTION_PENDING` above tolerance. |
| Bill Matching (2-way / 3-way, tolerance policy) | ✓ | (UI: Round-2) | BACKEND | **ADR-018 fully implemented.** Per-dimension verdicts (quantity/price/amount); three-way quantity judged against received (summed by material across the PO); cumulative across bills; out-of-tolerance → `EXCEPTION`, blocked by the posting gate. Structured exception reasons → resolution paths (`/resolve`): approve → `APPROVED_EXCEPTION`, supplier error → `DISPUTED` (never posts), price/quantity change → PO-revision→recommit→rematch, receipt correction → rematch. Auditable resolution. Flat platform-default tolerance (tunable). Only the Round-2 matching **UI** remains. |
| Commitment Ledger (COMMITTED→ACCRUED→ACTUAL) | ✓ | ✓ | INTEGRATED | Immutable signed entries; `CommitmentLedgerWriter`. |
| Subcontracts (subcontract BOQ, certificate, AP) | — | — | DESIGNED | ADR-012 (reuse certify engine + AP). Not built. |
| Approved Supplier List / Supplier Return | — | — | NOT_DESIGNED | |

---

## Inventory & Site (Flow B tail — physical → financial)

| Capability | Backend | Frontend | Status | Notes |
|---|---|---|---|---|
| Warehouses / site stores | — | — | NOT_DESIGNED | |
| Stock ledger (receipt/transfer/issue/return/adjust) | — | — | NOT_DESIGNED | **Issuing material to site = project cost — not yet possible.** |
| Inventory valuation | — | — | NOT_DESIGNED | |
| Project cost control (budget/committed/accrued/actual/forecast/variance) | ✓ (partial) | — | PARTIAL | Financial Position covers actual + committed + forecast margin; no consumption (needs Inventory) and no budget baseline. |
| Site daily reports / inspections | — | — | NOT_DESIGNED | |
| Labour / Equipment allocation | — | — | NOT_DESIGNED | |

---

## Other verticals

| Vertical | Status | Notes |
|---|---|---|
| Retail | NOT_DESIGNED | `retail.module.ts` empty stub only. |
| Manufacturing | NOT_DESIGNED | `manufacturing.module.ts` empty stub only. |
| Logistics / Real Estate / Consulting | NOT_DESIGNED | Named in vision; no code. |

---

## The strategic gap (from the domain review)

The commercial, procurement, and accounting spine is strong. The remaining work to make the
**Construction vertical a complete operating loop** is connecting *physical execution* to that
spine:

1. **Programme & Progress** (time + physical completion) — the biggest hole.
2. **Inventory** (stock issue → project consumption closes the cost loop).
3. **Variations / Change Management** (integrity of scope/price/time over the project life).
4. **Subcontracts** (design exists in ADR-012).

Do these before starting another vertical — see `docs/00-system-map.md` §"What not to build next".
