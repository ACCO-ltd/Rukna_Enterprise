---
Status: proposed
---

# Commercial billing: payment-schedule and certified-progress models

## Status note

Extends ADR-005 (commercial) and ADR-017 (commercial workspace). Domain input from **Eng Ahmed
Shirie**: ACCO bills primarily by a **negotiated payment schedule** (advance + staged milestone
installments), with certified-progress (IPA/IPC) for consultant-supervised contracts. Payment
milestone structure + configurability confirmed 2026-08-17. **Pending confirmation** (memo
`docs/backend-requests/commercial-payment-model-for-ceo.md`): advance-recovery method, retention
%/release, invoice-issue authority, divergence threshold, and the Handover-line question. Reuses
ADR-019 (guarded commands/readiness), ADR-021 (verified progress, the firewall), ADR-022 (DOA).

## Context

The system was built with IPA→IPC measured certification as the universal spine. ACCO's real
primary model is different: a **contract payment schedule** — an advance (~40%) plus staged
installments released as construction stages complete, **negotiated per contract**. Forcing IPA/IPC
on every contract is the wrong model; forcing a fixed schedule is equally wrong (percentages are
negotiated). The building blocks exist as unwired data (`ContractAdvanceTerm`, `ContractMilestone`,
`ContractRetentionTerms`); the flow that turns them into money was never built.

## Decision

### CONST-COM-009 — Billing model is a per-contract choice
`Contract.billingModel ∈ { PAYMENT_SCHEDULE, CERTIFIED_PROGRESS }`, chosen when the contract is
created. One model per contract for V1 (mixed deferred until ACCO needs it).

### CONST-COM-010 — Billing entitlement is the shared spine
The universal flow is **Contract terms → BillableEntitlement → Invoice → Collection**. A
`BillableEntitlement` ("this amount is now billable") has two *sources* depending on billingModel:
a **payment-schedule trigger satisfied**, or a **certified IPC**. Both converge on **one guarded
`Generate Invoice` command** and shared `ClientInvoice` / receipt / allocation. IPA/IPC is one
entitlement source, not the spine.

### CONST-COM-011 — ContractPaymentPlan with configurable installments
A `PAYMENT_SCHEDULE` contract owns a `ContractPaymentPlan` of installments, each with a percentage
and a trigger:
- **ADVANCE** — billed on a defined event (commencement / signing / guarantee submission).
- **TIME_BASED** — due N days after commencement, or on a fixed date.
- **MILESTONE** — on completion of a construction stage; **references a verified programme milestone**
  (ADR-021) as its evidence, never a free-standing note.

**ACCO default template** (org-level, editable per contract): Advance 40% · Structure 30% ·
Partition & Plastering 20% · Installation & Paint 10% · Inspection & Handover (final/retention
release — *pending confirmation whether it carries a %*).

### CONST-COM-012 — Percentages are configurable; the plan must reconcile
Every installment % is editable per contract (a client may negotiate 70% advance). **Invariant:**
`Σ(installment %) = 100%` of the scheduled contract value; a contract cannot activate with an
incomplete plan unless policy explicitly permits (e.g. provisional sums). An org-level **default
template** pre-fills new contracts (reusable-default pattern, like the BOQ Item Library).

### CONST-COM-013 — ACCO V1 does NOT use advance recovery
Confirmed with Eng Ahmed 2026-08-17: ACCO does **not** recover the advance from later installments.
The advance is simply the **first scheduled installment** (e.g. 40% on commencement); the remaining
installments sum with it to 100%. The `BillableEntitlement`/plan model *retains capacity* to add
advance recovery later for a contract that needs it, but it is **excluded from the contract form and
the V1 build**.

### CONST-COM-014 — ACCO V1 does NOT use retention
Confirmed with Eng Ahmed 2026-08-17: ACCO does **not** withhold retention on these contracts.
`ContractRetentionTerms` stays in the schema (capacity preserved) but retention is **not** part of
the V1 payment flow or the contract creation form. Add it only when a contract requires it.

### CONST-COM-015 — Billing is a guarded command, never automatic
A satisfied trigger sets the entitlement `READY_TO_BILL`; an **authorized user reviews and issues**
the invoice (ADR-019 guarded command; authority per ADR-022 DOA). A due date reached is *entitlement
readiness*, not a posted invoice — protecting against negotiation, suspension, dispute, or amended
terms. *Invoice-issue authority pending Eng Ahmed.*

### CONST-COM-016 — Payment plan is set in Preparation; post-activation change = amendment
The negotiated plan is finalised while the contract is in Preparation. After activation, material
payment-term changes require a **Contract Amendment** (not silent editing) — the same
baseline-protection principle as BOQ (ADR-020) and the contract commercial baseline (ADR-017
CONST-COM-001).

### CONST-COM-017 — CERTIFIED_PROGRESS = refined IPA/IPC
For consultant-supervised contracts the entitlement source is a certified IPC:
`verified progress → IPA (pre-filled suggestion, QS confirms) → IPC → BillableEntitlement → Invoice`.
Refinements: IPA internal approval **routes through `CommandGovernanceService` + DOA chains**
(ADR-022), not a bespoke flow; IPA claim quantities **pre-fill from verified progress** (ADR-021,
firewall-safe); the 8-state contract lifecycle **collapses** per the ADR-019 guarded-command pattern
(`UNDER_REVIEW`/`PENDING_SIGNATURE` → Preparation; signing = event → Active).

### CONST-COM-018 — Collection-vs-progress divergence signal
The Overview surfaces contractual collection % vs verified physical progress % (e.g. "collection 70%
/ progress 22% → divergence"). Management intelligence, not an accusation; alert threshold *pending
Eng Ahmed* (default: flag at >20% gap).

## Consequences
- New `ContractPaymentPlan` + `ContractPaymentInstallment`; `billingModel` on Contract; a
  `BillableEntitlement` seam that unifies both models onto shared invoicing.
- Reuses/rewires existing `ContractAdvanceTerm` (advance + recovery), `ContractRetentionTerms`
  (withholding + release), `ContractMilestone`/`ProgrammeMilestone` (installment reference), IPA/IPC
  (certified branch).
- Wires the previously-unbuilt "milestone certification + invoice generation" (capability matrix gap).
- Depends on Progress (ADR-021) for milestone verification and IPA pre-fill; on DOA (ADR-022) for
  approvals; on PlatformFile for milestone evidence.
- Firewall preserved (ADR-018/020/021): a trigger/progress *suggests* billing entitlement; a human
  authorizes the invoice.
- Open items (pending Eng Ahmed) block only the numeric config, not the structure.

## Implementation reconciliation (2026-08-19)

Two points where the shipped code differs from the wording above — recorded here so the divergence
is intentional, not drift:

- **`billingModel` vocabulary.** CONST-COM-009 names the values `{ PAYMENT_SCHEDULE, CERTIFIED_PROGRESS }`.
  The code ships the **pre-existing** `BillingModel = { MILESTONE, MEASURED_IPC }` enum, mapping
  **`MILESTONE ↔ PAYMENT_SCHEDULE`** and **`MEASURED_IPC ↔ CERTIFIED_PROGRESS`**. The existing enum was
  reused deliberately: renaming it is a breaking, cross-cutting migration (enum column + ~15 call sites +
  the commercial `responsibleRole`/workflow seed) for no behavioural gain — the same subtraction-not-rewrite
  principle applied elsewhere. Behaviour matches the ADR; only the labels differ. Reconcile by renaming later
  *or* treat this note as the naming amendment.
- **CONST-COM-011 milestone evidence — deferred.** The rule wants a `MILESTONE`/`PAYMENT_SCHEDULE`
  installment to reference a **verified programme milestone (ADR-021)** as its evidence. Programme milestones
  are ADR-021 *phase 2* (not built), so `ContractPaymentInstallment.milestoneLabel` is a free-text interim
  seam and `generateFromInstallment` bills on `percentage × contractValue`. The invoice remains a guarded
  human command (CONST-COM-015), so the cost↔revenue firewall holds; the evidence *link* lands with Programme
  milestones.

**Tracked tech-debt (not blocking):** `ipa.service.ts::getPrefill` reads `contract`/`certificate` via Prisma
directly in the application layer (an in-file pattern predating this ADR). It should route through
`IpaPrismaRepository` when that repo's reads are consolidated.
