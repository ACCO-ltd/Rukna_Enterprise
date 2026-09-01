# Accounting Round 2 — Backend Architecture (JD1–JD7)

**Status:** DECISIONS REQUIRED (see Verdict, §12)
**Date:** 2026-09-01
**Author:** Architect (backend, `apps/api`)
**Builds on:** ADR-006 (Accounting Foundation), ADR-011 (Approval Gate Single Seam), ADR-015 (Loop-back Re-drive), ADR-024 (single-currency USD), ADR-027 (Access Governance Administration — the parallel in-flight feature JD1 must consume)
**Scope:** DESIGN ONLY. No code changes. This document defines aggregate/module boundaries, invariants, service interfaces, transaction/authorization boundaries, failure modes, and migration/data semantics for the seven locked product decisions JD1–JD7.

---

## 0. Ground truth — what already exists

The current accounting backend is much further along than JD1–JD7 imply. This changes the work from "build" to "collapse / extend / harden". Establishing this first is load-bearing for every decision below.

| Area | Current reality | Source of truth |
|---|---|---|
| Posting engine | `AccountingPostingService implements IAccountingPostingPort`. Idempotency guard on `(org, sourceDocType, sourceDocId, eventType)`; double-entry, period, control-account validators; account-version snapshot at post; posts directly to `POSTED`. Caller owns the outer tx. | `accounting-core/infrastructure/accounting-posting.service.ts`, `.../ports/accounting-posting.port.ts` |
| Accounting-date rule | Honoured across AR/AP/receipts/payments/opening/year-end: postings use the document's `accountingDate`/`billDate`/`reversalDate`, never `now()`. `now()` appears only for audit stamps (`postedAt`, `closedAt`, `reopenedAt`). | `supplier-bill.service.ts`, `manual-journal.service.ts`, `opening-balance.service.ts` |
| Governance seam | `CommandGovernanceService.gateStateTransition(...)` + `throwIfGated(...)`, driven by `WorkflowTriggerBinding` rows (data, not code). Returns `null` when no binding → transition proceeds ("governance OFF" is the default). Consumed today by SupplierBill/SupplierPayment/PO/IPA/BoqVersion/VariationOrder. | `command-governance.service.ts`, `supplier-bill.service.ts` (canonical pattern) |
| Journal lifecycle | `JournalStatus = DRAFT|SUBMITTED|APPROVED|REJECTED|POSTED|REVERSED`. `ManualJournalService` hardcodes DRAFT→SUBMITTED→APPROVED→POSTED and **always** writes `approvedBy/approvedAt`. It calls `SegregationOfDutiesService` (self-approval block) but **never** calls `CommandGovernanceService`. | `manual-journal.service.ts` |
| Period lifecycle | `PeriodStatus = OPEN|LOCKED|CLOSED|REOPENED`. `PeriodManagementService` implements lock/close/reopen with a lock gate and a close gate (AR/AP control reconciliation, unposted-journal check) and generates the balance snapshot before CLOSED. | `general-ledger/application/period-management.service.ts` |
| Balance snapshot | `PeriodAccountBalance` (dimension-aware, `snapshotVersion`, `VALID|INVALID|REBUILDING`). `SnapshotService.generateForPeriod / invalidateDownstream / rebuildFromPeriod`. | `snapshot.service.ts`, schema `PeriodAccountBalance` |
| Opening migration (GL) | `OpeningBalanceService.runWizard` posts one idempotent `EVT-OPB-001` SYSTEM_OPENING journal from a trial balance. | `opening-balance.service.ts` |
| **Open-item migration (AR/AP)** | **Already exists.** The same wizard creates `ClientInvoice`/`SupplierBill` rows with `postingStatus = OPENING_BALANCE` + `migrationBatchId`, `documentStatus = APPROVED`, `sourceIpcId = null`. `PostingStatus.OPENING_BALANCE` is an enum member, excluded from the "unposted approved" close check, and included in AR/AP reconciliation sums. | `opening-balance.service.ts`, schema `PostingStatus`, `ClientInvoice.migrationBatchId` |
| Year-end close | `YearEndCloseService.closeYear` exists: validates FY OPEN/LOCKED + Period 12 LOCKED + priors CLOSED, idempotency on `EVT-YE-001`, computes net P&L, posts `YEAR_END_CLOSE` SYSTEM journal to Retained Earnings, snapshots P12, closes P12 + FY. **No reopen; FY has no `CLOSING` status transition used.** | `year-end-close.service.ts`, schema `FiscalYearStatus` |
| Project P&L / job costing | `PLReportService.generate` filters `JournalLine` by `projectId`/`departmentId` dimensions, excludes `entryPurpose = CLOSING`, computes revenue/CoS/expense/net. `@@index([projectId])`, `@@index([contractId])` present. `ProjectFinancialPositionService` adds committed-cost forecast. | `pl-report.service.ts`, `financial-position/*` |
| CoA | `Account` (stable `code`+`normalBalance`) + effective-dated `AccountVersion`. `AccountService.create/importChartOfAccounts` only. **No update/retire command; no edit-by-posting-state logic.** | `account.service.ts`, schema `Account`/`AccountVersion` |
| Bank | `BankAccount` (1:1 GL account, `isReconcilable`, `BankAccountStatus`). `ReconciliationService` does control-account (AR/AP) recon + a **placeholder** bank check that reports `variance = 0.00, reconciled = true` and comments "statement reconciliation is Phase 3". **No statement, no statement lines, no matching aggregate.** | `reconciliation.service.ts`, schema `BankAccount` |
| Access-governance parallel feature | ADR-027 ACCEPTED (2026-08-31). Confirms the seam: business modules keep consuming `CommandGovernanceService`; approval policies are versioned `WorkflowDefinition`+`WorkflowTriggerBinding`; in-flight `ApprovalInstance` continues on its creating version; publication is four-eyes + audited. | `docs/adr/ADR-027-access-governance-administration.md` |

**Consequence:** JD3 (open-item modeling), JD4/JD6 (project P&L), and most of JD2 (period state machine + snapshot) are **CONFIRMED already built** — Round 2 hardens gate taxonomy and reopen semantics, it does not invent them. JD1 (collapse the fake approval + consume the seam), JD5 (CoA edit-by-posting-state + retire), and JD7 bank reconciliation are the genuine new domain contracts.

---

## 1. JD1 — Governance-aware journal lifecycle

### Problem restated
Today every manual journal is forced through DRAFT→SUBMITTED→APPROVED→POSTED and **always** writes `approvedBy/approvedAt`, even when no real enforced approval occurred. That is a *faked* control: the audit trail asserts a four-eyes approval that the system never actually required. JD1 says: when governance is OFF, collapse to DRAFT→POSTED (optionally with SUBMITTED) with **no APPROVED state and no approval audit event**; when governance is ON, run the full enforced chain — and it must run through the **same** ADR-011/ADR-027 governance seam, not a parallel one.

### Boundary & ownership
`JournalEntry` remains owned by `AccountingCoreModule` (manual journals in `ManualJournalsModule`). Governance decision-making stays owned by `platform/workflows` (`CommandGovernanceService`). JD1 makes the journal a **consumer** of that seam exactly like `SupplierBill`.

### Design

1. **Add `JournalEntry` to `GovernedEntity`** (`packages/types/src/enums.ts`). The transition registry already declares `MANUAL_JOURNAL: ['DRAFT:SUBMITTED']` (`policy-transition-registry.ts`) — it is pre-wired and currently unconsumed.

2. **Route submission through the seam.** In `ManualJournalService.submit`, mirror `SupplierBillService.submit`:
   ```
   throwIfGated(
     await commandGovernance.gateStateTransition(identity, 'JournalEntry', 'DRAFT', 'SUBMITTED', journal.id, journalAmount),
     'Journal submission requires workflow approval.'
   )
   ```
   - `journalAmount` = Σ debit (= Σ credit) so the amount-band resolver (ADR-022 CONST-DOA-005) can select the right chain.
   - **No binding configured → returns `null` → transition proceeds** with no approval instance. This IS "governance OFF".

3. **Collapse the lifecycle by policy, not by faking state.** The single behavioural rule:
   > `approvedBy/approvedAt` and `status = APPROVED` are written **only** when a real `ApprovalInstance` reached `APPROVED` (consumed via `gateStateTransition` returning `null` after `markInstanceConsumed`) **or** the org's `PostingPolicy.requireFourEyesOnJournals = true`. When neither holds, the journal moves DRAFT→(SUBMITTED)→POSTED and the `approve()` command is **not a valid transition** — `post()` is callable from DRAFT/SUBMITTED.

   This removes the fabricated approval event. The APPROVED state still exists in the enum (needed for governance ON and for reversal-of-posted immutability), but is never entered without enforcement.

4. **Enforcement set for governance ON** (all already have primitives in the codebase):
   - **SoD self-approval block** — `SegregationOfDutiesService.assertAllowed({ action: 'APPROVE_MANUAL_JOURNAL', journalPreparerUserId })` (exists; keep).
   - **Approver authority** — carried by the `WorkflowStep.roleRequired` chain resolved by the trigger binding (ADR-027 GOV-ADM-005). Not re-implemented in accounting.
   - **No-post-before-approval** — `post()` rejects unless the journal is APPROVED *when a binding exists for this org/entity/band*. Determined by "is there a live `ApprovalInstance` for this `transactionId`?" — if yes, it must be APPROVED/consumed.
   - **Rejected → correction** — REJECTED is terminal for that instance; the preparer edits a DRAFT clone and re-submits (ADR-015 re-drive already reconciles prior instances).
   - **Posted immutable → reversal only** — already enforced (`reverse()` requires POSTED; POSTED lines never mutate).

### Integration contract with the access-governance seam (ADR-027)
- Accounting **imports only** `CommandGovernanceService` + `SegregationOfDutiesService` from `platform/workflows`. It never imports the ADR-027 policy-authoring module, `WorkflowTriggerResolverService`, or repositories directly (ADR-027 GOV-ADM-005 boundary; matches `supplier-bill.service.ts`).
- The **only new coupling** is one enum value (`GovernedEntity += 'JournalEntry'`) and one transition-registry entry (already present). Both are in `packages/types` / `platform/workflows` — owned by the governance side, so they must be landed there first.
- In-flight instances continue on their creating policy version (ADR-027 GOV-ADM-005) — accounting does nothing special; it only reads instance status via the seam.

### Coordination risk (flag)
The access-governance feature is **uncommitted/in-progress** but its ADR is ACCEPTED and the runtime seam (`CommandGovernanceService`, `WorkflowTriggerBinding`, `policy-transition-registry`) is **already merged and consumed by AP/PO/IPA**. So JD1 does **not** depend on unmerged code — it depends on the *stable, already-shipped* seam. The risk is narrower: **who owns adding `'JournalEntry'` to `GovernedEntity` and seeding the `WorkflowTriggerBinding` for `MANUAL_JOURNAL DRAFT:SUBMITTED`.** Sequence JD1 *after* the ADR-027 role-catalogue seeding so a real approver role exists for the journal chain (§11).

### Transaction / authorization
- Auth: `PERMISSIONS.journalsManage` (`manage:journal`) on all journal endpoints (exists). Governance ON adds the step-role check inside the seam.
- Tx: submission/approval are single-row status updates; `post()` keeps the existing `$transaction` (posting + status flip atomic). Gate check runs **before** the tx (it may create an `ApprovalInstance` and 409).

### Failure modes
- Binding exists but chain has no eligible approver → seam returns gate; `post()` blocked. (ADR-027 GOV-ADM-006 validates non-empty chains at publish, so this is a config/publish-time failure, surfaced early.)
- Preparer = only approver + SoD active → `ForbiddenException` on approve; journal stuck SUBMITTED until a second user approves (correct).
- Governance toggled ON mid-life for a DRAFT created under OFF → on `submit` it now gates; consistent, because the gate is evaluated at transition time.

### ADR-worthy? **Yes** — this changes the journal domain contract (APPROVED becomes enforcement-gated, not default). Draft ADR text in §12.

---

## 2. JD2 — Period lifecycle `OPEN → LOCKED → CLOSED` + pre-close gate + snapshot + reopen

### Current reality
State machine, lock gate, close gate, and immutable snapshot already exist (`PeriodManagementService`, `SnapshotService`, `PeriodAccountBalance`). JD2 is **hardening**, not greenfield. Three real gaps:

1. **The close gate does not classify BLOCKER vs INFORMATIONAL.** `checkCloseGate` returns a flat `blockers[]`; everything is fatal. JD2 requires a taxonomy.
2. **The gate omits required checks**: unreconciled *reconcilable bank accounts* (JD7 dependency), posting failures (`postingStatus = FAILED` docs), financially-inconsistent docs.
3. **The close snapshot is `PeriodAccountBalance` only** — JD2's "immutable balance snapshot on close" additionally wants a single close-record header (TB hash, AR/AP control, ids, timestamp, closed-by, check results) as the auditable close certificate. Today that certificate is implicit.

### Design

**State machine (unchanged, now formalized):**
```
OPEN ──lock──▶ LOCKED ──close──▶ CLOSED ──reopen──▶ REOPENED ──lock──▶ LOCKED ...
```
- `OPEN`: routine posting allowed (any category).
- `LOCKED`: routine posting **blocked**; only `journalCategory = CLOSING_ADJUSTMENT` accepted (already enforced by `PeriodValidator`). This is the "authorized close adjustments allowed" state.
- `CLOSED`: no postings.
- `REOPENED`: treated as OPEN but flagged; only correcting/adjusting entries (existing invariant).

**Pre-close gate contract** — replace `blockers: string[]` with a structured finding list:
```
GateFinding {
  code: PeriodCloseCheckCode
  severity: 'BLOCKER' | 'INFORMATIONAL'
  message: string
  detail?: Json   // e.g. { glBalance, subledgerBalance, variance }
}
CloseGateResult { passed: boolean; findings: GateFinding[] }   // passed = no BLOCKER findings
```

**Blocker taxonomy (hard — must be $0 / clean to close):**
| Code | Check |
|---|---|
| `AR_GL_MISMATCH` | AR GL closing ≠ Σ open ClientInvoice.outstanding (exists) |
| `AP_GL_MISMATCH` | AP GL closing ≠ Σ open SupplierBill.outstanding (exists) |
| `UNPOSTED_REQUIRED_JOURNAL` | DRAFT/SUBMITTED/APPROVED journal in period (exists) |
| `POSTING_FAILURE` | any source doc `postingStatus = FAILED` **or** `documentStatus = APPROVED & postingStatus IN (NOT_POSTED, FAILED)` in period (partially in `ReconciliationService`, must move into gate) |
| `FINANCIALLY_INCONSISTENT_DOC` | e.g. invoice/bill where `outstanding > total` or `allocated + unallocated ≠ total` |
| `UNRECONCILED_BANK` | any `BankAccount.isReconcilable = true` lacking an approved `BankReconciliation` covering the period (JD7 dependency) |

**Informational taxonomy (warn, never block):**
| Code | Check |
|---|---|
| `NO_PROGRESS_SNAPSHOT` | project with activity but no `ProgressSnapshot` at period end |
| `DIMENSION_COVERAGE_GAP` | posted lines missing an OPTIONAL-but-recommended dimension |
| `FX_REVALUATION_PENDING` | reserved (multi-currency, deferred) |

**Blocker vs informational is org-configurable at the margins** via `BankingPolicy.requireBankReviewBeforeClose` (exists) — when `false`, `UNRECONCILED_BANK` downgrades to INFORMATIONAL. This preserves the current toggle while defaulting to safe.

**Immutable close certificate (new).** Add a `PeriodCloseRecord` header written in the same tx as CLOSED:
```
PeriodCloseRecord {
  id, organizationId, accountingPeriodId (unique per close attempt),
  closedBy, closedAt,
  trialBalanceDebit, trialBalanceCredit,     // must be equal
  arControlBalance, apControlBalance,
  snapshotVersion,                            // links the PeriodAccountBalance generation
  checkResults Json,                          // the GateFinding[] captured at close
  reopenedAt?, reopenedBy?, reopenReason?     // set if later reopened
}
```
`PeriodAccountBalance` stays the per-account detail; `PeriodCloseRecord` is the one-row certificate. On reopen the record is **not deleted** — a new close record is written on re-close (history preserved), the prior gets `reopenedAt`.

**Reopen invariants (mostly exist, one addition):**
- Only CLOSED → REOPENED (exists).
- Invalidates this period's + all downstream snapshots (exists).
- **New:** a fiscal year that is CLOSED cannot have a period reopened without first reopening the FY (JD7 year-end interplay, §7). Guard added to `reopenPeriod`.
- Controlled + audited: reason, reopenedBy, reopen approver (schema fields exist: `reopenReason`, `reopenedBy`, `reopenApprovedBy`).

### Transaction / authorization
- New permission `PERMISSIONS.periodManage` (`manage:accounting-period`) for lock/close/reopen (today these ride `accountingManage`). Reopen additionally requires the approver identity (CFO) — model as a required `reopenApprovedBy` distinct from `reopenedBy` (four-eyes on reopen).
- Tx boundary: `close()` = one tx: run gate (read-only) → generate snapshot → write `PeriodCloseRecord` → set CLOSED. Gate BLOCKER aborts before any write.

### Migration/data semantics
- New table `period_close_records` → **Prisma migration required.**
- New enum `PeriodCloseCheckCode` and severity handling live in application types (no DB enum needed unless persisted; `checkResults` is Json).
- No change to `AccountingPeriod` columns (reopen fields already present).

### ADR-worthy? **Partly** — the gate taxonomy (blocker vs informational) and the `PeriodCloseRecord` certificate are contract-level; fold into the Round-2 ADR.

---

## 3. JD3 — Two-layer opening migration

### Current reality — this is CONFIRMED already built
`OpeningBalanceService.runWizard` implements **both** layers in one idempotent flow:
- **Layer 1 (GL TB):** one `EVT-OPB-001` SYSTEM_OPENING journal from the trial balance; idempotency on `(OPENING_BALANCE, EVT-OPB-001)`; rejects if TB unbalanced.
- **Layer 2 (open items):** creates `ClientInvoice`/`SupplierBill` rows with `postingStatus = OPENING_BALANCE`, `documentStatus = APPROVED`, `migrationBatchId = batchRef`, `sourceIpcId = null`, `outstandingAmount = totalAmount`. These populate AR/AP subledgers **without** the IPC→invoice or PO→bill workflow.

So the JD3 modeling question — *reuse ClientInvoice/SupplierBill with an origin flag, or a separate table?* — **is already answered in code: reuse with an origin flag.** This design ratifies that and closes its gaps.

### Ratified model
Migrated open items ARE `ClientInvoice`/`SupplierBill` rows distinguished by:
- `postingStatus = OPENING_BALANCE` (the origin flag — a dedicated enum member, not a boolean, so it is impossible to confuse a migrated item with a normally-posted one).
- `migrationBatchId` non-null.
- `sourceIpcId`/`sourceInstallmentId`/`purchaseOrderId` null.

**Why reuse beats a separate table:** settlement must work uniformly. A migrated invoice is settled by the *same* `PaymentReceipt → ClientReceiptAllocation` path as a normal invoice; a migrated bill by the *same* `SupplierPayment → SupplierPaymentAllocation` path. A separate `MigratedOpenItem` table would fork every settlement, reconciliation, and aging query. The enum member gives origin visibility without the fork.

### Invariant enforcement (the core JD3 requirement)
> **AR subledger total = AR control account; AP subledger = AP control account.**

This is enforced at three moments — the design **strengthens** the middle one:
1. **At migration:** `runWizard` reconciles GL vs subledger and only reports `readyForCfoApproval` on zero variance (exists). **Gap:** it reports but does not *block*. Add a hard invariant: the wizard tx **rolls back** if `arVariance > 0.01` or `apVariance > 0.01`. Reporting a non-zero variance as merely "not ready" leaves a poisoned dataset committed.
2. **At every period close:** `AR_GL_MISMATCH` / `AP_GL_MISMATCH` blockers (§2) re-verify continuously. `OPENING_BALANCE` items are already included in the subledger sum (`postingStatus IN ('POSTED','OPENING_BALANCE')`).
3. **At settlement:** existing allocation invariants (`allocated + unallocated = total`, `allocation ≤ outstanding`) hold identically for migrated items — no special path.

### Interoperability with normal settlement
- A receipt/payment settling a migrated item posts the **normal** cash/AR (EVT-AR-*) or cash/AP (EVT-AP-*) journal. The opening journal already put the aggregate AR/AP balance on the GL; settling reduces both GL control and subledger outstanding in lockstep. No double count because the migrated item itself never posts an individual journal (its `OPENING_BALANCE` status excludes it from posting).
- **Edge to guard:** a migrated item must **never** be "posted" through the normal `post()` path (that would double the GL). Add a guard: `ClientInvoice/SupplierBill` with `postingStatus = OPENING_BALANCE` reject `post()` / `approve()`-to-post transitions.

### Migration/data semantics
- **No new tables/columns** — the model exists. The only changes are behavioural (hard rollback on variance; block re-posting of opening items). **No Prisma migration needed for JD3.**

### ADR-worthy? **Yes, as ratification** — the "reuse-with-origin-flag" decision and the AR=control / AP=control invariant should be recorded explicitly (it currently lives only as code + a schema comment). Prevents a future dev from "cleaning up" by adding a separate migrated-items table.

---

## 4. JD4 / JD6 — Project P&L / job costing as a dimension read model

### Current reality — CONFIRMED built
`PLReportService.generate` is already a read model over `JournalLine` dimensions (`projectId`, `departmentId`), not per-project GL accounts. It excludes `entryPurpose = CLOSING`, groups by account, and computes revenue/CoS/GP/expense/net. `boqNodeId` is on every line for finer job costing. `@@index([projectId])` and `@@index([contractId])` exist. `ProjectFinancialPositionService` adds the committed-cost forecast view.

JD4/JD6 confirm the **architecture is correct** and specify three refinements.

### Design refinements
1. **Keep GL classification separate from job-cost dimension (already true).** An account's `accountClass` decides P&L section; `projectId`/`boqNodeId` decide *attribution*. No per-project accounts — ever. Record this as an invariant so no one adds "Project X Revenue" accounts.
2. **Interaction with period snapshots.** `PLReportService` deliberately reads **live** `JournalLine` (not `PeriodAccountBalance`) so dimension filters and CLOSING exclusion work — correct, because `PeriodAccountBalance` is dimensioned but a project-filtered TB from snapshots would need every `(period, account, project)` row and still exclude closing. **Decision:** project P&L is a **live-line** read model; snapshots remain the account-level statement source. For closed periods this is still exact (posted lines are immutable). Document the deliberate divergence so it is not "optimized" into snapshot reads.
3. **Performance / indexing.** Current single-column `@@index([projectId])` is adequate for one-project queries but a period-bounded project P&L scans `projectId + accountingDate`. Add a composite index to support the hot path:
   - `@@index([projectId, accountId])` on `JournalLine`, and rely on the existing `entry.accountingDate` index via the `entry` relation. If profiling shows the join dominates, introduce a covering index or a `vw_posted_project_lines` view (ADR-006 permits read-only views). **Index add = Prisma migration required** (low risk, additive).
4. **`boqNodeId`-level job costing (JD6 finer grain).** Same read model grouped by `boqNodeId` instead of/in addition to `accountId`. No schema change — `boqNodeId` already on `JournalLine`. Add a `by-boq-node` grouping mode to the report service.

### Authorization / failure
- Auth: reporting permission (existing report controller guards). No governance gate (read-only).
- Failure: none new; a project with no lines returns empty sections (current behaviour).

### ADR-worthy? **No** — it ratifies ADR-006/ADR-013. Capture the "live-line, never per-project-account, never snapshot-for-project-P&L" invariants in the Round-2 ADR as a guardrail. The index add is a routine migration.

---

## 5. JD5 — CoA edit-by-posting-state + retire-not-delete

### Current reality — genuine gap
`AccountService` has `create` and `importChartOfAccounts` only. There is **no update command**, **no retire command**, and **no edit-by-posting-state logic**. `Account.code` and `Account.normalBalance` are documented immutable; `AccountVersion` carries editable attributes; `AccountStatus = ACTIVE|INACTIVE` exists but nothing transitions it. JD5 is new application logic on an existing model (no new tables).

### Design

**"Has postings" — determined cheaply.** A single existence check, not a count:
```
hasPostings(accountId) = EXISTS(JournalLine WHERE accountId = :id)   // any status
```
Use `SELECT 1 ... LIMIT 1` (or Prisma `findFirst({ select: { id: true } })`). `JournalLine.accountId` is indexed (`@@index([accountId, createdAt])`), so this is O(1)-ish. Cache within the request; never `count()`.

**Editability rules (authorization + invariant):**
| Attribute | Before any posting | After first posting |
|---|---|---|
| `code` | immutable (identity) | immutable |
| `normalBalance` | immutable (identity) | immutable |
| `accountClass` | editable (new version) | **frozen** — changing class re-signs history |
| `accountSubtype` | editable | **frozen** if control meaning changes; descriptive re-subtype within same class **blocked** by default (safe) |
| `isControlAccount` / `controlledSubledgerType` / `controlPostingPolicy` | editable | **frozen** — control meaning is load-bearing for reconciliation |
| `name`, `parentAccountId` (reporting rollup), `changeReason` | editable (new `AccountVersion`) | **editable** (descriptive only) |

Rule of thumb encoded as an invariant: **after first posting, only *descriptive* attributes may change; never class, normal balance, or control meaning.** Every edit after first posting creates a new `AccountVersion` (effective-dated) — the hidden versioning stays; historical journals resolve their version by `accountingDate` (ADR-006 §3.1, already implemented in the posting engine).

**Retire, never delete:**
- `ACTIVE → INACTIVE` is the only "removal". Guard: an INACTIVE account rejects new postings (posting engine already resolves the active version; add an `isPostingAllowed`/status check so INACTIVE cannot be a posting target).
- **Delete is prohibited once referenced** by any `JournalLine`, `BankAccount`, `PostingProfileVersion`, `TaxCode`, or `FiscalYear.retainedEarningsAccountId`. Even unreferenced, deletion of a COA account is out of scope — retire instead (aligns with the repo's "soft delete on financially-referenced entities" rule).

**New service interface (`AccountService`):**
```
updateAccount(identity, accountId, patch):   // creates a new AccountVersion
  - if hasPostings: reject patch touching {accountClass, controlFields, normalBalance-adjacent}
  - else: allow broad edit, still via new version
retireAccount(identity, accountId, reason):  // ACTIVE → INACTIVE, audited; reject if already referenced-as-control-with-open-subledger
reactivateAccount(identity, accountId):       // INACTIVE → ACTIVE (audited)
```

### Transaction / authorization
- Auth: `PERMISSIONS.accountingManage` (exists). Consider a stricter `manage:coa` for retire/reclassify (a governance-sensitive act) — flagged as a decision.
- Governance: reclassification of a *control* account is high-risk; optionally route `updateAccount` control-meaning changes through `CommandGovernanceService` with a new `GovernedEntity = 'Account'`. Default: permission + audit only (matches ExtensionOfTime precedent — guarded command, no DOA chain). **Decision required** (§12).
- Tx: single-tx add-version or status flip + `AuditLog`/`AuditOutboxEvent` (existing audit pattern).

### Migration/data semantics
- **No new tables/columns.** `AccountStatus`, `AccountVersion.versionNumber`, effective-dating all exist. **No Prisma migration required** (unless a `manage:coa` permission row is seeded — that is a data seed, not a schema migration).

### ADR-worthy? **Yes** — "editability degrades on first posting; control meaning is frozen; retire-not-delete" is a domain contract not currently written down.

---

## 6. JD7a — Bank Reconciliation (new aggregate)

### Current reality — genuine greenfield
No bank statement, statement line, or matching model exists. `ReconciliationService`'s bank branch is a hardcoded `reconciled: true` placeholder. This is the largest new build in Round 2.

### Aggregate boundaries
New module `bank-reconciliation` under `business/accounting` (subledger-layer peer of AR/AP). Two aggregates:

```
BankReconciliation (root)
  ├─ id, organizationId, bankAccountId (FK), accountingPeriodId?
  ├─ statementRef, statementDate, statementOpeningBalance, statementClosingBalance, currencyCode
  ├─ status: DRAFT → IN_PROGRESS → COMPLETED → APPROVED  (+ REOPENED)
  ├─ reconciledDifference (Decimal)   // must be 0 to reach APPROVED
  ├─ reconciledBy?, reconciledAt?, approvedBy?, approvedAt?
  ├─ reopenedBy?, reopenedAt?, reopenReason?
  └─ lines: BankStatementLine[]

BankStatementLine
  ├─ id, bankReconciliationId, lineDate, description, amount (signed), bankReference
  ├─ matchStatus: UNMATCHED | MATCHED | PARTIALLY_MATCHED
  └─ matchedJournalLineId?   // link to the GL cash movement it clears
```

**Boundary rules:**
- One `BankReconciliation` per `(bankAccount, statementDate)` — `@@unique`.
- The aggregate is the consistency boundary: statement lines and their matches commit together.
- It **reads** GL cash movements (`JournalLine` where `accountId = bankAccount.glAccountId`, POSTED) but **never** writes journals itself except via `AccountingPostingPort` for adjustments (below). It imports the port, not `JournalRepository` (ADR-006 dependency rule).

### Matching model
- A statement line matches one or more GL cash `JournalLine`s for the bank's GL account. `MATCHED` (exact), `PARTIALLY_MATCHED` (split/partial), `UNMATCHED` (in statement, not in GL — needs an adjustment; or in GL, not in statement — timing difference / outstanding item).
- **Reconciled difference** = statementClosingBalance − (statementOpeningBalance + Σ matched GL movements + Σ adjustment postings). Must be `0.00` to reach `COMPLETED`/`APPROVED`.

### Charge / interest adjustment postings
- Bank charges, interest earned, FX (deferred), and corrections are posted via `AccountingPostingPort` with a new `SourceDocType = BANK_RECONCILIATION`, `journalCategory = CASH_AND_BANK`, `eventType = EVT-BR-001` (charge) / `EVT-BR-002` (interest).
- **Accounting-date rule:** the adjustment journal uses the **statement line's date** (or `statementDate`), never `now()`.
- Idempotency: the posting port's `(org, BANK_RECONCILIATION, reconLineId, eventType)` guard prevents double-posting an adjustment.

### Invariants
- `status = APPROVED` ⇒ `reconciledDifference = 0` **and** every non-timing line is `MATCHED`/`PARTIALLY_MATCHED` **and** all adjustment journals POSTED.
- Immutable once APPROVED: statement lines, matches, and the difference cannot change. Correction requires **controlled reopen** (`APPROVED → REOPENED`, audited: reopenedBy/at/reason) mirroring the period-reopen pattern; adjustment journals are reversed, not edited.
- A reconciliation may only cover POSTED GL movements (never DRAFT).

### Integration with JD2 period close
- New `BankingPolicy.requireBankReviewBeforeClose = true` (field exists) makes the period close gate emit `UNRECONCILED_BANK` **BLOCKER** for any `BankAccount.isReconcilable = true` without an `APPROVED` `BankReconciliation` whose `statementDate` ≥ period end (or covering the period per policy). When the policy is `false`, it downgrades to INFORMATIONAL (§2).
- This is the **only** coupling between JD7a and JD2 — a read the gate performs; the recon module does not know about period close.

### Transaction / authorization
- Auth: new `PERMISSIONS.bankReconciliationManage` (`manage:bank-reconciliation`). Approve step is four-eyes-capable: `approvedBy` must differ from `reconciledBy` (SoD), optionally routed through `CommandGovernanceService` with `GovernedEntity = 'BankReconciliation'` and transition `IN_PROGRESS:COMPLETED` or `COMPLETED:APPROVED`.
- Tx: matching edits are aggregate-local single-tx; each adjustment posting is its own `$transaction` via the port; `approve()` verifies `difference = 0` and flips status in one tx.

### Migration/data semantics
- New tables `bank_reconciliations`, `bank_statement_lines`; new enums `BankReconciliationStatus`, `BankStatementLineMatchStatus`; add `BANK_RECONCILIATION` to `SourceDocType` and (if desired) `BankAccountReconciliationRef`. **Prisma migration required.**

### ADR-worthy? **Yes** — new aggregate, new posting events, new close-gate coupling.

---

## 7. JD7b — Year-End Close (state machine, separate from period close)

### Current reality
`YearEndCloseService.closeYear` exists and does most of the mechanics (P&L zeroing → Retained Earnings, snapshot P12, close P12+FY, idempotent on `EVT-YE-001`). Gaps vs JD7:
- **No `CLOSING` intermediate state used.** `FiscalYearStatus = DRAFT|OPEN|LOCKED|CLOSED` exists but `closeYear` goes straight OPEN/LOCKED → CLOSED. JD7 wants `ACTIVE → CLOSING → CLOSED` (a pre-flight/compute window).
- **No reopen / re-close.** JD7 requires controlled reopen with history preservation.
- **No explicit BS carry-forward step.** Balances carry implicitly via `PeriodAccountBalance` chaining into next year's opening; JD7 wants this explicit and next-year-open guaranteed.
- **`netPL` computation double-branches** and the loss/income sign handling is fragile (both income and expense subtract in one branch) — a **correctness risk** to fix during hardening (not an architecture change, but flagged).

### State machine (formalize using existing enum)
```
ACTIVE ──begin-close──▶ CLOSING ──finalize──▶ CLOSED ──reopen──▶ CLOSING ──re-finalize──▶ CLOSED
```
- Map `ACTIVE` to the existing `OPEN` value (or add `ACTIVE` — decision: reuse `OPEN` to avoid an enum churn; the FY is "active" while `OPEN`). Add **`CLOSING`** as the pre-flight/compute state (enum already has `LOCKED`; **decision:** use `LOCKED` as CLOSING, or add `CLOSING`. Recommend **adding `CLOSING`** for clarity since `LOCKED` on a FY is ambiguous vs period LOCKED — flagged §12).
- **Precondition:** final period (P12) must be CLOSED **first** — JD7 is explicit that year-end is separate and follows the last period close. (Current code requires P12 *LOCKED*; JD7 wants P12 *CLOSED*. **Change:** require P12 CLOSED, post the year-end journal into an ADJUSTMENT window. **Decision required** — ACCO has no Period 13, so year-end must post into P12; that means P12 cannot be fully CLOSED before the close journal. Resolve by: P12 LOCKED → post year-end close journal (CLOSING category) → snapshot → P12 CLOSED → FY CLOSED, which is what the code does. So **keep P12 LOCKED precondition**; JD7's "final period CLOSED first" is satisfied by P12 reaching CLOSED *within* the year-end transaction. Document this ACCO-specific ordering.)

### Closing-journal generation & retained-earnings transfer
- One immutable `SYSTEM_YEAR_END_CLOSE` journal (`entryPurpose = CLOSING`, `journalCategory = YEAR_END_CLOSE`, `postingOrigin = SYSTEM_YEAR_END`) zeroes every INCOME/COST_OF_SALES/EXPENSE account and nets to `FiscalYear.retainedEarningsAccountId` (EQUITY). Accounting-date = P12 `endDate` (existing; compliant).
- **Fix during build:** compute net P&L as `Σ(credit − debit)` over INCOME minus `Σ(debit − credit)` over COST_OF_SALES+EXPENSE, one pass, sign-correct. Current two-branch logic must be corrected (flagged as a spec-level bug to fix, not re-architected).

### Idempotency, reopen, history
- **Idempotency:** existing `EVT-YE-001` guard (no duplicate close). Keep.
- **Reopen:** `CLOSED → CLOSING` (FY) requires: FY is the latest closed FY (cannot reopen a FY if a later FY is already closed — same monotonicity as period reopen), reason + approver (four-eyes), audited. Reopen **reverses** the `SYSTEM_YEAR_END_CLOSE` journal (a `REVERSAL` of `EVT-YE-001`), re-opens P12, invalidates P12 snapshot + next-year opening. It does **not** delete history — the reversal and the original both persist.
- **Re-close:** re-runs the compute → posts a fresh `EVT-YE-002`(re-close) journal → re-snapshots. A `FiscalYearCloseRecord` (analogous to `PeriodCloseRecord`) captures each close attempt (netIncome, journalId, closedBy, closedAt, reopened metadata) so the audit shows the full close/reopen/re-close chain.
- **BS carry-forward (explicit):** after FY CLOSED, guarantee the next `FiscalYear` exists and its Period 1 opening chains from P12 closing snapshot (asset/liability/equity balances carry; income/expense are zeroed by the close journal). Add a post-close assertion; if next FY is absent, the close still succeeds but flags `NEXT_YEAR_NOT_CREATED` (informational).

### Transaction / authorization
- Auth: new `PERMISSIONS.yearEndCloseManage` (`manage:year-end-close`); reopen requires distinct approver (four-eyes).
- Tx: `closeYear` stays one `$transaction` (post journal + snapshot + status flips). Reopen is one tx (reverse journal + invalidate snapshots + status flips).

### Migration/data semantics
- Add `CLOSING` to `FiscalYearStatus` (if chosen); new table `fiscal_year_close_records`; `EVT-YE-002` is a data/event constant. **Prisma migration required.**

### ADR-worthy? **Yes** — year-end state machine, reopen/re-close semantics, and the close-record are new domain contracts.

---

## 8. Cross-cutting invariants (must hold across JD1–JD7)

1. **Accounting-date rule** — every posting (adjustments, close, reversal) uses the source document's date, never `now()`. Audit stamps (`postedAt`, `closedAt`, `approvedAt`, `reconciledAt`) use `now()` and are distinct fields. (Already the codebase convention; new modules MUST follow.)
2. **Prisma in infrastructure only** — new bank-rec and close-record repositories live in `infrastructure/`; services take repos, never `PrismaClient` beyond the tenant `getClient()` seam already used. Posting always via `AccountingPostingPort`.
3. **Caller owns the outer transaction** into the posting port (ADR-006). Bank-rec adjustments and year-end close honour this.
4. **Governance is data-driven and backward-compatible** — a missing `WorkflowTriggerBinding` = governance OFF = transition proceeds. No accounting module hardcodes an approval.
5. **Immutability + reversal** — POSTED journals, APPROVED reconciliations, CLOSED periods/years never mutate; correction is reversal + controlled reopen.
6. **GL is the single source of truth** — project P&L, reconciliation, and close all derive from `JournalLine`; no module stores financial totals that bypass the GL.

---

## 9. Consolidated migration / schema-change inventory

| JD | New tables | New columns/enums | Prisma migration? |
|---|---|---|---|
| JD1 | — | `GovernedEntity += 'JournalEntry'` (types), seed `WorkflowTriggerBinding` (data) | **No schema migration** (types + data seed) |
| JD2 | `period_close_records` | `PeriodCloseCheckCode` (app enum, not DB) | **Yes** (close-record table) |
| JD3 | — | — (model already exists) | **No** |
| JD4/JD6 | — | `@@index([projectId, accountId])` on `JournalLine` | **Yes** (additive index) |
| JD5 | — | possible `manage:coa` permission (seed) | **No schema** (seed only) |
| JD7a | `bank_reconciliations`, `bank_statement_lines` | `BankReconciliationStatus`, `BankStatementLineMatchStatus`, `SourceDocType += BANK_RECONCILIATION` | **Yes** |
| JD7b | `fiscal_year_close_records` | `FiscalYearStatus += CLOSING`, `EVT-YE-002` (constant) | **Yes** |

All migrations are additive (new tables, new enum members, new index) — no destructive changes, no backfill of financial data. Enum additions to `SourceDocType`/`FiscalYearStatus`/`GovernedEntity` are backward-compatible.

---

## 10. Failure-mode summary (new/changed)

| Scenario | Behaviour |
|---|---|
| Journal submit, no binding | Proceeds (governance OFF); no APPROVED state written. |
| Journal submit, binding, no eligible approver | 409 gated; `post()` blocked until approved. (Publish-time validation should prevent empty chains — ADR-027.) |
| Period close, bank not reconciled, policy strict | `UNRECONCILED_BANK` BLOCKER; close refused. |
| Period close, informational finding only | Close proceeds; findings recorded in `PeriodCloseRecord.checkResults`. |
| Migration variance ≠ 0 | **Tx rolls back** (hardened); nothing committed. |
| Attempt to `post()` an OPENING_BALANCE item | Rejected (would double GL). |
| Bank-rec approve with difference ≠ 0 | Rejected. |
| Year-end reopen when a later FY is closed | Rejected (monotonicity). |
| Year-end close journal double-run | Idempotency guard returns existing (no duplicate). |
| CoA reclassify control account after postings | Rejected (control meaning frozen). |

---

## 11. Coordination & sequencing plan (given the ADR-027 dependency)

The access-governance seam (`CommandGovernanceService`, `WorkflowTriggerBinding`, transition registry) is **already merged and consumed** by AP/PO/IPA — JD1 depends on the *stable* seam, not on unmerged ADR-027 UI work. The real coordination points:

1. **Land governance types first (JD1 prerequisite).** `GovernedEntity += 'JournalEntry'` and the `MANUAL_JOURNAL` binding seed live on the governance/platform side. Sequence: (a) ADR-027 role-catalogue seeding provides a real approver role → (b) add `JournalEntry` to `GovernedEntity` + seed the binding → (c) wire `ManualJournalService.submit` to the seam and collapse the fake approval. Doing (c) before (a)/(b) is safe (returns null) but leaves the fake approval in place, so keep them in one change.
2. **JD3 ratification is independent** — pure documentation + two behavioural guards; can land immediately, unblocks nothing.
3. **JD2 gate taxonomy before JD7a close-coupling** — the `UNRECONCILED_BANK` blocker needs the gate to already emit structured findings.
4. **JD7a (bank-rec) before turning on the strict bank blocker** — build the aggregate, then flip `BankingPolicy.requireBankReviewBeforeClose` per org.
5. **JD7b year-end after JD2** — year-end reopen reuses the period-reopen + snapshot-invalidation machinery and the monotonicity guard.
6. **JD5 is independent** of governance unless the `Account` control-reclassification gate is chosen (§12 decision).

Recommended order: **JD3 → JD2 → JD5 → JD1 → JD7a → JD7b.** (JD4/JD6 index add is trivial, land anytime.)

---

## 12. ADR-worthy decisions, open decisions, and verdict

### ADR-worthy decisions (draft into a single "ADR-028: Accounting Round 2 — Governed Journals, Period/Year Close, Bank Reconciliation")
1. **JD1 — Journal governance integration.** APPROVED state and approval audit are written **only** under real enforcement (binding-driven or `requireFourEyesOnJournals`); the fake auto-approval is collapsed. Journals consume `CommandGovernanceService` via `GovernedEntity = 'JournalEntry'`; accounting never imports the policy-authoring module.
2. **JD3 — Migrated open items = `ClientInvoice`/`SupplierBill` with `postingStatus = OPENING_BALANCE` origin flag (reuse, not a separate table); AR-subledger = AR-control and AP-subledger = AP-control is a hard invariant enforced by tx-rollback at migration and by the period-close gate continuously.**
3. **JD2 — Pre-close gate finding taxonomy (BLOCKER vs INFORMATIONAL) + immutable `PeriodCloseRecord` certificate; reopen is four-eyes and monotonic.**
4. **JD5 — CoA editability degrades on first posting (descriptive-only after; class/normal-balance/control-meaning frozen); retire-not-delete via `ACTIVE→INACTIVE`.**
5. **JD7a — `BankReconciliation`/`BankStatementLine` aggregate; adjustments posted via the port on the statement date; couples to period close only through the `UNRECONCILED_BANK` gate.**
6. **JD7b — Fiscal-year close state machine with `CLOSING`, controlled reopen/re-close, `FiscalYearCloseRecord`, explicit BS carry-forward.**
7. **JD4/JD6 — Project P&L is a live-line dimension read model; per-project GL accounts are prohibited; project P&L never reads `PeriodAccountBalance`.** (Guardrail-level; can be a section in ADR-028 rather than its own ADR.)

### DECISIONS REQUIRED (need a human — Abdulsalam / Eng Ahmed)
- **D1 (JD5 authorization).** Does reclassifying/retiring a **control** account route through `CommandGovernanceService` (`GovernedEntity = 'Account'`) or is permission + audit (`manage:coa`) sufficient? Precedent (ExtensionOfTime) is permission+audit; control accounts are higher risk.
- **D2 (JD7b enum).** Add `CLOSING` to `FiscalYearStatus`, or overload the existing `LOCKED`? Recommend adding `CLOSING` to disambiguate FY-close from period-lock. Confirm the enum churn is acceptable.
- **D3 (JD7b ordering for ACCO).** Confirm the ACCO-specific "P12 LOCKED → post year-end journal into P12 → P12 CLOSED → FY CLOSED" ordering (no Period 13). JD7 says "final period CLOSED first"; for ACCO that is satisfied only *within* the year-end tx. Needs Eng Ahmed's sign-off that year-end entries post into December.
- **D4 (JD2 bank blocker default).** Ship `BankingPolicy.requireBankReviewBeforeClose` defaulting to `false` (current) or `true`? Defaulting `true` is safer but blocks close until JD7a is live for every org.
- **D5 (JD1 permission granularity).** Keep journal approval on `journalsManage`, or split an `approve:journal` permission distinct from `manage:journal` so the approver role in the governance chain is permission-gated independently of the preparer?

### VERDICT

**DECISIONS REQUIRED.**

The architecture is sound and, critically, **most of it already exists** — JD3, JD4/JD6, and the JD2 state machine + snapshot are CONFIRMED built; JD7b is largely built. The design collapses the one genuinely unsafe thing found (JD1's fabricated approval audit) onto the existing, already-shipped governance seam without duplicating it, and adds two clean greenfield builds (JD7a bank reconciliation, JD2 close certificate). Nothing in this design violates an existing invariant or the ADR-006 boundaries. It is blocked only on the five named product/authorization decisions (D1–D5) above — none of which are architectural blockers, but each changes a contract detail (permission model, enum, ACCO close ordering) that must be a human decision, not silently chosen. Resolve D1–D5, fold the seven ADR-worthy items into ADR-028, and this proceeds to `spec`.
