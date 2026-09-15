# Commercial workspace redesign — implementation spec

**Type:** FULL-STACK · **Status:** ready for tickets · **Date:** 2026-09-13
**Contract for:** ADR-030 (accepted) + `commercial-workspace-redesign.md` (design, §7 billing model) +
`commercial-workspace-redesign-architecture.md` (grounding).
**Vocabulary:** uses ADR-030 terms — *cycle ribbon, money story, Billing Package, VariationBillingAllocation,
entitlement vs realization, WITH_STAGE / STANDALONE, STAGE_REDUCTION*.

Every MUST/SHOULD below is testable. Phase-2 (credit notes) and Phase-3 (one-document `ClientInvoiceLine`,
Option A) are **OUT OF SCOPE** here and listed in §8.

---

## 1. Contract create — subtract to essentials (CD1–CD3)

**Actor:** Engineering (contracts:create). **Route:** `/projects/:id/commercial/contract/new`.

- **S-CC-1 (MUST)** — The create DTO no longer requires `boqVersionId`, `contractValue`, or
  `contractNumber`. The server resolves the project's **single committed BOQ** and derives value from its
  tie-out (`ContractService.create` already calls `deriveTieOutValue`). *Test:* POST with only
  `{clientId, startDate, expectedEndDate, billingModel?}` creates a contract whose `baseContractValue ==
  contractValue == in-contract tie-out`; supplying a mismatched value is ignored or 400s, never overrides.
- **S-CC-2 (MUST)** — No committed BOQ ⇒ create is **refused** with a domain error the UI renders as a gate
  ("Commit the BOQ first"). *Test:* POST against a project with only a DRAFT BOQ → 400/409 with a
  `BOQ_NOT_COMMITTED`-style code; no contract row written.
- **S-CC-3 (MUST)** — Contract number is **system-generated** from the project code via an **atomic
  per-project sequence** in infrastructure (mirroring the ADR-025 project-code pattern), unique per org.
  *Test:* two concurrent creates on one project yield distinct numbers `…-C1`, `…-C2`; no collision.
- **S-CC-4 (SHOULD)** — `billingModel` defaults to `MILESTONE` when omitted. *Test:* omitted → `MILESTONE`.
- **S-CC-5 (MUST, frontend)** — The form renders **client + start + expected-end** only; value shows read-only
  as `from the committed BOQ` (live tie-out, CD7); number shows read-only/auto. *Test:* no editable value or
  number or BOQ-version input in the DOM; the tie-out figure matches the committed BOQ total.

## 2. Workspace shell + cycle ribbon (CD4, CD5, CD15, CD16)

**Actor:** any commercial viewer. **Routes:** `/projects/:id/commercial/{contract,payment-schedule,variations,billing}`.

- **S-SH-1 (MUST)** — For a `MILESTONE` contract the workspace exposes exactly **four tabs**: Contract ·
  Payment Schedule · Variations · Billing. **No Overview tab; no Applications tab.** *Test:* nav renders 4
  tabs; `/commercial` (old Overview) redirects to the landing tab; deep-linking `/applications` on a
  MILESTONE contract shows the existing "not applicable" state, not a crash. Measured contracts still show
  Applications (CONST-COM-026).
- **S-SH-2 (MUST)** — A **persistent cycle ribbon** renders on every tab: `stage · blocker (if any) · one
  action`. It consumes the existing `getCurrentCycle` read model (a *lift*, not a rebuild). *Test:* the
  ribbon shows the same stage/nextAction on all four tabs; the action routes/behaves identically.
- **S-SH-3 (MUST, backend)** — `getCurrentCycle` returns the milestone-verification **blocker on the
  MILESTONE branch** (today it returns `blockers:[]`). *Test:* a NEXT installment linked to an
  un-verified programme milestone returns a blocker `{kind, installmentId, remediationUrl}`.
- **S-SH-4 (MUST)** — "Contract & Security" tab is renamed **"Contract"**; retention and advance panels
  render **only when configured** (non-null terms). Guarantees stay. *Test:* a MILESTONE contract with no
  retention/advance terms shows neither panel; the tab label is "Contract".
- **S-SH-5 (SHOULD)** — The **money story** (Contract value → Invoiced → Collected → Outstanding) that
  Overview showed now lives on **Billing** (§5); nothing is lost. *Test:* every figure previously on Overview
  is reachable on Billing or the ribbon.

## 3. Variation billing — Phase 1 (CD10/CD11/CD12 → CONST-COM-023/027/028/029)

**Actor:** Commercial (variations:manage; billing generation per existing capability).

### Domain / persistence
- **S-VB-1 (MUST)** — Add `VariationOrder.billingTreatment: WITH_STAGE | STANDALONE`, default `WITH_STAGE`.
- **S-VB-2 (MUST)** — New table **`VariationBillingAllocation`** `{ id, variationId, amount, treatment:
  INVOICE | STAGE_REDUCTION, clientInvoiceId?, installmentId?, createdAt, org/audit }`. (`CREDIT_NOTE`
  treatment + `creditNoteId` are declared in the enum/column but unused in P1 — see §8.)
- **S-VB-3 (MUST, invariant CONST-COM-028)** — For any variation, `Σ allocation.amount == variation.netValue`
  **once fully realized**; the system never lets the same VO dollar be realized twice. *Test:* attempting a
  second INVOICE allocation that would exceed `netValue` is rejected; a fully-billed VO has Σ==net.
- **S-VB-4 (MUST, CONST-COM-027)** — Entitlement is unchanged: approving a VO still moves `contractValue`
  (current) by the net with `baseContractValue` frozen (existing `raiseCurrentValueForVariation`). Billing
  realization (allocations/invoices) is a **separate** layer and does not alter the milestone %-schedule.
  *Test:* after approving VO-001 (+2,000), `contractValue` rises 2,000, `baseContractValue` and the 40/30/20/10
  installment percentages are unchanged, and no invoice/allocation exists until billing.

### Billing flow
- **S-VB-5 (MUST)** — "Bill this stage" lets the operator **include or defer** each eligible client-approved
  variation for the stage being billed. Generating produces: the milestone `ClientInvoice`
  (`generateFromInstallment`) **plus** one `ClientInvoice` per included VO (via `generateFromSeparateCharge`,
  tagged with `sourceVariationId` + the `installmentId`), each an independently-payable receivable. *Test:*
  billing Milestone 2 with VO-001 included writes two invoices; billing with VO-001 excluded writes one, and
  VO-001 remains billable later.
- **S-VB-6 (MUST)** — A positive VO invoice created this way records an `INVOICE` allocation
  `{variationId, +amount, clientInvoiceId, installmentId}`. *Test:* the allocation exists and links both ids.
- **S-VB-7 (MUST)** — A **Billing Package** is a **read model** (no table): invoices grouped by
  `(installmentId, billingCycle)`, presented as "Milestone N Billing" with the base + each VO line and a
  presented total. *Test:* the read model groups the milestone invoice + its VO invoices; the presented total
  equals their sum; each remains individually payable.
- **S-VB-8 (MUST, CONST-COM-029)** — An **omission** on a stage **not yet invoiced** reduces that stage's
  invoice: the generated milestone invoice subtotal = `pct×base − Σ omission`, with a `STAGE_REDUCTION`
  allocation `{variationId, −amount, clientInvoiceId, installmentId}` and a document label naming the omission.
  *Test:* Milestone 3 ($105,600) with omission VO-002 (−3,000) bills $102,600; the allocation records −3,000.
- **S-VB-9 (MUST)** — A VO whose stage is **already invoiced** cannot be netted into it (that path is the
  credit note, §8). *Test:* attempting STAGE_REDUCTION against an already-invoiced installment is refused
  with a clear "already invoiced — a credit note is required (not yet available)" error.
- **S-VB-10 (SHOULD, CONST-COM-030)** — Tax is computed by the existing engine but surfaced as **"Sales Tax
  5%"** for ACCO (the `vatAmount` field/label is relabeled at the surface, mechanism unchanged). *Test:*
  invoice/PDF surfaces read "Sales Tax", not "VAT".

### Frontend
- **S-VB-11 (MUST)** — The "Bill this stage" dialog lists the stage amount + each eligible VO with an
  include/defer control and a live "billing now / deferred" summary. *Test:* toggling a VO updates the
  totals; Generate produces the package.
- **S-VB-12 (MUST, CD11)** — The Variations list shows, per VO, its `billingTreatment`, allocation status,
  and an inline **"Invoiced?"** chip resolved from the existing certified/invoiced-by-variation read model —
  no drill into a second table. *Test:* a billed VO shows "✓ invoiced (INV-xxx)"; an approved-unbilled VO
  shows "approved · not billed".

## 4. Payment schedule polish (CD8, CD9 → CONST-COM-024/025)

- **S-PS-1 (MUST, CONST-COM-025)** — A gated installment renders its **reason + remediation link on the row**
  (`⛔ Verify "<milestone>" →`) and the Generate-invoice control is disabled *with that adjacent explanation*.
  No disabled control whose reason lives only on another screen. *Test:* a blocked NEXT row shows the reason +
  a working link to the milestone; no bare disabled button.
- **S-PS-2 (MUST, CONST-COM-024)** — The plan editor **blocks Save** when editable rows don't reconcile
  (100% DRAFT; `100 − invoiced%` ACTIVE); the server already enforces this (`assertPaymentPlanReconciles`) —
  the client must mirror it (disabled Save + live delta). *Test:* a 95% plan cannot be submitted from the UI.
- **S-PS-3 (MUST)** — Already-invoiced rows render **visibly locked** under a `"N% already billed — editing
  the remaining M%"` header and are immutable. *Test:* invoiced rows are non-editable and labeled.

## 5. Billing — money story + professional chart (CD13/CD14)

- **S-BL-1 (MUST)** — Billing hosts the **money story**: `Contract value → Invoiced → Collected →
  Outstanding`, with **approved-but-unbilled variations shown distinctly** (entitlement ≠ billed, so a
  deferred VO reads "approved $X · billed $0", never as a leak). *Test:* a deferred VO shows in the
  variations adjustment, not as missing revenue.
- **S-BL-2 (MUST)** — A **collected-vs-invoiced cashflow curve** is the hero visual, derived from existing
  invoice/receipt dates (a read-model time series; no new write path). *Test:* the curve's cumulative
  invoiced/collected match the ledger at each point.
- **S-BL-3 (SHOULD)** — An aging view (current / 30 / 60 / 90) is present. *Test:* buckets sum to outstanding.

## 6. Migrations & compatibility

- **S-MG-1 (MUST)** — One additive migration: `VariationOrder.billingTreatment` (default `WITH_STAGE`) +
  the `VariationBillingAllocation` table. **No change to `ClientInvoice`** (header-only stays). Backfill:
  existing approved VOs get `WITH_STAGE`; existing standalone-billed VOs (if any) get a back-filled
  `INVOICE`/`STANDALONE` allocation so the exactly-once invariant holds retroactively. *Test:* migrate on a
  clone of prod data; every existing VO satisfies `Σ allocations == netValue` or is unrealized.
- **S-MG-2 (MUST)** — MEASURED_IPC contracts are unaffected (Applications path intact); retention/advance
  data intact. *Test:* a measured contract's Applications flow and a retention-bearing contract are unchanged.

## 7. Authorization & visibility

- **S-AZ-1 (MUST)** — All new actions reuse existing capability gates (contracts:create/manage,
  variations:manage, billing generation). Money figures obey `financialsVisible` (RESTRICTED, never $0).
  *Test:* a no-financials user sees the ribbon/structure but money is withheld, not zeroed.

## 8. Out of scope (future phases)

- **P2** — `CreditNote` aggregate + `CREDIT_NOTE` allocation treatment + sales-tax reversal + AR
  credit/refund, for omissions on already-invoiced stages (S-VB-9's blocked path). Gated on ACCO's
  accountant confirming Somali sales-tax + credit-note formatting.
- **P3** — `ClientInvoiceLine` / Option A one-document itemised invoice, only if same-document billing is
  later confirmed. The allocation ledger + Billing-Package projection carry over unchanged.
- The Overview aggregate/read model is retired, not extended.

## Test list (summary)
Contract create (S-CC-1..5) · shell/tabs/ribbon (S-SH-1..5) · variation billing domain + flow + FE
(S-VB-1..12) · schedule polish (S-PS-1..3) · billing story+chart (S-BL-1..3) · migration + compat
(S-MG-1..2) · authz (S-AZ-1). Backend gets unit + DB-backed integration (mirroring the BOQ redesign
verification); frontend gets component tests for the ribbon, the bill-this-stage include/defer, the
variations "Invoiced?" chip, the plan-editor hard-stop, and the cashflow chart.
