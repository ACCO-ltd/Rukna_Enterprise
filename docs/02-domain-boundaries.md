# Rukna — Domain Boundaries & Source-of-Truth Rules

For any fact in the system, an engineer must be able to answer:
**What owns this fact? What aggregate changes it? Which ledger records it? What event triggers
the next step?** This document answers those questions. The canonical, longer aggregate
reference is `docs/reference/domain-model.md`; this file is the quick ownership map.

## Aggregate ownership

`Project` is the scope/context and reporting root — **not** a DDD God Aggregate. It connects
separate aggregates that each own their lifecycle and invariants:

| Aggregate | Owns | Must NOT own |
|---|---|---|
| **Project** | Identity, status, membership, commercial/participation model, reporting root | BOQ pricing, contract terms, journals |
| **BOQ** | Scope structure, quantity, unit, rate, pricing, `measurementMethod`, baseline, revision lineage | Progress, time, actual cost, money paid |
| **Programme** *(ADR-021, not built)* | Time: activities, dates (baseline/forecast/actual), milestones, versions, `ProgressTarget` curve | BOQ scope/quantity/rate; contract value; IPA/IPC quantities |
| **WorkPackage** *(ADR-021, not built)* | Control seam: responsible owner, `progressWeight`, BOQ↔activity allocation, status | Scope/price (references BOQ); certification |
| **Progress (DPR/Measurement)** *(ADR-021, not built)* | Verified physical progress from approved DPRs; evidence chain | Claimed/certified quantity; auto-billing |
| **Contract** | Terms, retention, advances, guarantees, milestones, contract value | Scope structure (references BOQ), postings |
| **IPA** | Client-facing valuation (what we claim) | Certification decision |
| **IPC** | Certified valuation (what the client accepted) | AR posting |
| **AR (Invoice/Receipt)** | Billing + collection accounting | Certification |
| **Procurement (MR/PO/GRN/Bill match)** | Need → order → receipt → match | GL truth, scope |
| **Commitment Ledger** | Cost exposure progression (COMMITTED→ACCRUED→ACTUAL) | Statutory financial position |
| **General Ledger** | Statutory double-entry truth | Commitments, forecasts |

## Source-of-truth rules (the ones people get wrong)

1. **BOQ owns scope + pricing.** Programme owns time/progress; Procurement and Accounting may
   *reference* BOQ nodes but never *mutate* them.
2. **Commercial ≠ Accounting.** A certified IPC is a commercial fact. Revenue exists only when
   an AR invoice is **posted** to the GL in a period.
3. **Two ledgers stay separate.** `CommitmentLedgerEntry` is never merged into `JournalLine`.
   GL answers "what happened"; the Commitment Ledger answers "what will it cost once
   commitments land".
4. **Cost timing has three stages:** PO approved → `COMMITTED`; goods received → `ACCRUED`;
   supplier bill posted → `ACTUAL`. Only ACTUAL is a GL expense.
5. **Buying material ≠ charging the project.** Purchase creates commitment/inventory; *issuing*
   material to site creates project consumption/cost. (Inventory not yet built — this loop is
   currently open.)
6. **Frozen commercial baseline.** After a contract leaves DRAFT, material contractual change
   should flow through a **Variation**, not by editing an executed contract. (Variation not yet
   built; provenance fields on `BoqNode` are prepared.)
7. **Accounting date rule.** Allocation/reversal postings use the *source document's*
   `accountingDate`, never `new Date()`.

## Governance is infrastructure, not a module

RBAC, DOA, workflow, and audit are **cross-cutting** — every sensitive business command calls
them. They are not "the workflow module sitting next to Procurement".

```
BUSINESS COMMAND ("Approve PO for $500,000")
        │
   Governance layer:  RBAC (can this user?) + DOA (who must approve?)
        │
     Command  →  Audit Outbox (same DB transaction)
```

`CommandGovernanceService.gateStateTransition()` is the single seam. It returns `null` (proceed)
or `{ gated: true, approvalInstanceId }` (block with 409). See ADR-011 / ADR-015.

## Documents are a shared platform capability (when built)

The business entity owns the *relationship and meaning* (this file is a Guarantee scan); the
platform should own storage, versioning, checksum, access, preview, download, audit. Today only
per-entity attachment **metadata** rows exist — no storage/serving layer (ADR-014, not built).

## Cross-domain triggers (event → next step)

| Event | Triggers |
|---|---|
| Contract `PRACTICAL_COMPLETION` | Contract → `FINAL_ACCOUNT_PENDING` |
| IPC certified | AR invoice becomes generatable |
| PO approved | Commitment `COMMITTED` |
| GRN posted | Commitment `ACCRUED` |
| Supplier bill posted | Commitment `ACTUAL` + GL `Dr Expense / Cr AP` |
| Supplier payment posted | GL `Dr AP / Cr Bank` |
