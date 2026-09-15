---
Status: accepted
---

<!-- ACCEPTED 2026-09-13 via /grill-with-docs on the Commercial workspace. CD1–CD16 owner-approved
(Abdulsalam); CD10 (variation billing) agreed with Eng Ahmed; architecture pass done. The agreed
variation-billing realization model (Option C + allocation ledger + phasing) is in design doc §7.
Owed: spec + tickets, and ACCO's accountant confirming sales-tax / credit-note formatting before Phase 2.
Companion: docs/design/commercial-workspace-redesign.md (+ -architecture.md). -->

# Commercial workspace: subtract to a professional, QuickBooks-clean money surface

## Context

The Commercial workspace shipped under **ADR-017** (five-tab workspace, settlement ownership),
**ADR-023** (milestone payment schedule + certified progress), and **ADR-026** (variations /
change orders). It was then refined ("P3", tracked in
`docs/design/commercial-billing-model-refinement.md`): the standalone `/contracts` UI was folded
into the project workspace, contract create/edit and IPA/IPC authoring moved to project-scoped
routes, a first-class **Payment Schedule** tab was added for MILESTONE contracts, and the tab set
became billing-model-aware (`commercialTabsFor` hides Applications for MILESTONE).

Separately, **ADR-029** reframed the BOQ as ACCO's internal budget with a **commit-to-contract
tie-out**: a project now has exactly one *committed* BOQ whose in-contract total the contract must
equal (`TIEOUT_MISMATCH`), and there are **no user-facing BOQ versions**.

A grilling session (2026-09-13, `/grill-with-docs` on Commercial) established that the workspace,
though functionally complete, does not yet match how ACCO wants to *work* it:

- **It carries fields that ADR-029 made obsolete.** The contract-create form still asks the user to
  pick a "BOQ version" (there are none), to type the contract value (it is the tie-out), and to type
  a contract number. The version picker even renders *"This project has no committed BOQ version
  yet."* — a dead end.
- **It is heavier than ACCO's single billing model needs.** ACCO bills **MILESTONE** (40/30/20/10);
  the measured Applications→Certificate (IPA/IPC) path, retention, and advance-recovery are dead
  weight on every screen. "Contract & Security" foregrounds security instruments ACCO does not use.
- **The money story is split** across Overview, Billing, and Contract & Security, and the "what to
  do next" driver is trapped on the Overview tab.
- **Raising extra money is not intuitive.** A variation bills as a disconnected standalone line; the
  owner wants it to *partner* with a milestone the way QuickBooks attaches a line to an invoice
  (milestone 150k + VO 2k = 152k, itemised).
- **Several dead-ends** remain: a gated installment shows a disabled *Generate invoice* with the
  reason on a different screen; the DRAFT→ACTIVE lifecycle has no next-step button; the plan editor
  lets you save a plan that does not total 100%; there is no live tie-out in the form; and "has this
  variation been invoiced?" needs drilling two places.

This ADR records the resulting **subtract-then-professionalise** decisions. It **refines** ADR-017's
tab model and the contract-creation form, **hardens** ADR-023's plan-reconciliation rule, and
**extends** ADR-026 variations with an installment-billing partnership (which — per the architecture
pass — needs a **new** persisted `VariationOrder → installment` link plus invoice line-items;
`stageInstallmentId` is today only a read-model placeholder, not persistence). It does not change
ADR-023's core billing math or ADR-029's tie-out invariant.

## Decision

### Domain / UX vocabulary — fixed

| Term | Definition |
|---|---|
| **Cycle ribbon** | A persistent band on every Commercial tab showing `stage · what's blocking · the one next action`. The single "where am I / what next" surface, shared in spirit with the BOQ money strip. |
| **Money story** | The one canonical revenue chain for a MILESTONE contract: **Contract value → Invoiced → Collected → Outstanding**, with variations and (if ever used) retention as adjustments. It lives in one place (Billing), not three. |
| **Partnered variation** | An approved variation that bills **with** a chosen milestone, shown as an itemised **sub-line** on that installment's invoice. Contrast: a **standalone** variation line, billed on its own. |

### The decisions (CD1–CD16)

**Subtract — the clean-up (owner-approved):**

- **CD1 / CONST-COM-020** — The contract binds to the project's **single committed BOQ**; the
  BOQ-version picker is **removed**. No committed BOQ ⇒ the create flow is *gated* ("Commit the BOQ
  first →"), never an empty dropdown.
- **CD2 / CONST-COM-021** — **Contract value is the BOQ tie-out, read-only.** The value input is
  removed; the figure is read from the committed BOQ's in-contract total (already enforced server-side
  as `TIEOUT_MISMATCH`, ADR-029). It is never hand-entered.
- **CD3 / CONST-COM-022** — **Contract number is system-generated** from the project code
  (`ACCO-WBR-26-0065` → `…-C1`). Not a required input.
- **CD4** — "Contract & Security" → **"Contract"**. Retention and advance-recovery sections render
  **only when actually configured** (ACCO configures neither). Guarantees (performance bonds) stay as
  a compact section.
- **CD5 / CONST-COM-026** — The **Applications / Certificates** (measured IPA/IPC) surface is
  **hidden-dormant**: present only for `MEASURED_IPC` contracts, never for MILESTONE. The measured
  path is retained in code, not deleted.
- **CD16 / CONST-COM-026** — For a MILESTONE contract the workspace exposes exactly **four tabs**:
  **Contract · Payment Schedule · Variations · Billing**. The separate **Overview tab is removed**;
  its "what next" moves to the ribbon and its money figures move to Billing.

**Guide — the next-step grammar (shared with BOQ):**

- **CD6** — A single **"Advance contract"** next-step button drives the lifecycle
  (Submit → Approve → Execute); the DRAFT→ACTIVE rail becomes a quiet progress indicator.
- **CD7** — The (now minimal) contract form shows the **live BOQ tie-out** beside the read-only value.
- **CD15 / CONST-COM-025** — The **cycle ribbon** is persistent on every tab.

**Payment schedule — professional:**

- **CD8 / CONST-COM-025** — A billing gate renders its **reason + remediation link at the point of
  action** (on the installment row: `⛔ Verify "Partition" milestone →`), never only on a summary
  screen. No disabled button without an adjacent "why / how to unblock".
- **CD9 / CONST-COM-024** — The plan editor **blocks Save** when the editable rows do not reconcile
  to the required total (100% for DRAFT; `100 − invoiced%` for ACTIVE). Invoiced rows are visibly
  **locked** and immutable, under a `"N% already billed — editing the remaining M%"` header. (Hardens
  ADR-023 CONST-COM-012 from a soft warning to a hard gate.)

**Variations — QuickBooks-clean money-raise (CD10 billing model agreed with Eng Ahmed 2026-09-13):**

- **CD10 / CONST-COM-023/027/028** — A client-approved variation is an **independently-billable unit**.
  **Agreed realization (design doc §7):** it bills as its **own `ClientInvoice`** (via the existing
  `generateFromSeparateCharge` path), tagged to a chosen installment and **grouped with the milestone
  invoice into a "Billing Package" projection** (Option C) — the milestone %-schedule stays frozen on
  `baseContractValue`, and a **`VariationBillingAllocation` ledger records each VO dollar exactly once**.
  The user chooses `WITH_STAGE` or `STANDALONE` at billing time (include-or-defer per what the client
  agreed to pay now). **Phase 1 needs only the small allocation-ledger migration** — the earlier
  design-doc claim of "no schema change / a `stageInstallmentId` seam" was wrong (that field is a
  read-model placeholder, `commercial.service.ts:1074`; `ClientInvoice` is header-only). Same-document
  itemisation (Option A / `ClientInvoiceLine`) is **deferred to Phase 3**; folding a VO into the
  milestone subtotal (Option B) is **UNSAFE** (CONST-BOQ-032 / CONST-VAR-008). This **refines** ADR-029
  V-3: a VO stays a separately-identifiable document, now grouped under its milestone.
- **CD12 / CONST-COM-029** — An **omission** (negative variation) reduces the affected stage when it is
  **not yet invoiced** (`STAGE_REDUCTION`), or is reversed by a **credit note against the immutable
  original** once **already invoiced** — trigger is INVOICED, not PAID; one omission may split across both.
- **CD11** — Every variation carries an inline **"Invoiced?" chip** so the certified/invoiced trace is
  answerable without drilling into a second table.

**Billing — professional:**

- **CD13** — Billing hosts the unified money story and a **collected-vs-invoiced cashflow curve** as
  the hero visual, plus an aging view. (Presentation, not an invariant.)

### New constraints

| ID | Constraint |
|---|---|
| **CONST-COM-020** | A client contract binds to the project's single committed BOQ; no version is selected or selectable. |
| **CONST-COM-021** | Contract value equals the committed BOQ in-contract tie-out and is never hand-entered or independently editable. (Reinforces ADR-029 I-1.) |
| **CONST-COM-022** | A client contract number is system-generated from the project code and is not a user-supplied field. |
| **CONST-COM-023** | A client-approved variation is an **independently-billable unit**: it bills as its **own `ClientInvoice`** (via `generateFromSeparateCharge`), tagged to a chosen installment and grouped into a "Billing Package" projection with the milestone invoice (Option C). `WITH_STAGE` or `STANDALONE` is chosen at billing time; the installment %-schedule stays frozen on `baseContractValue`. Same-document itemisation (Option A / `ClientInvoiceLine`) is deferred to Phase 3. *(Agreed with Eng Ahmed 2026-09-13.)* |
| **CONST-COM-024** | The payment-plan editor rejects any save whose editable rows do not reconcile to the required total; already-invoiced installments are immutable. |
| **CONST-COM-025** | A blocked action renders its reason and remediation at the point of action; the workspace never shows a disabled control whose explanation lives only on another screen. |
| **CONST-COM-026** | The Commercial tab set is exactly what the contract's billing model requires; a MILESTONE contract shows `Contract · Payment Schedule · Variations · Billing` and no Overview or Applications surface. |
| **CONST-COM-027** | Contract **entitlement** (base + Σ approved VO net) and billing **realization** (invoices / credit-notes) are separate layers; approving a VO moves entitlement, not any document. |
| **CONST-COM-028** | Every approved variation dollar is realized **exactly once**: `Σ VariationBillingAllocation.amount for a VO == VO.netValue`. |
| **CONST-COM-029** | An omission is realized by a **stage reduction** while its stage is un-invoiced and by a **credit note against the immutable original** once invoiced (trigger = INVOICED, not PAID); one omission may split across both. |
| **CONST-COM-030** | Tax is a generic engine surfaced for ACCO as **"Sales Tax 5%"**; statutory sales-tax / credit-note formatting is confirmed with ACCO's accountant before Phase-2 compliance is encoded. |

## Consequences

- **Contract create shrinks to essentials** — client + dates (+ billing model, defaulting to
  Milestone). Value, number, and BOQ version disappear as inputs. The `contract-creation-form-spec`
  and parts of ADR-017's five-tab model are **refined**.
- **The workspace loses a tab** (Overview) and gains a **persistent ribbon**; the "current cycle"
  read model that powered Overview now feeds the ribbon on every tab.
- **Variation billing gains a realization layer** (agreed model, design doc §7): a small
  `VariationBillingAllocation` ledger + a "Billing Package" projection, with a VO billed as its own
  `ClientInvoice` via the existing `generateFromSeparateCharge` path (Option C). **Phase 1 needs only
  the allocation-ledger migration** — no new aggregate, no `ClientInvoiceLine`, no credit notes.
  `CreditNote` is Phase 2; same-document itemisation (Option A) is Phase 3. The base 40/30/20/10 billing
  math is unchanged.
- **Retention / advance-recovery / measured-IPC** stay in the code but leave the default surface;
  nothing is deleted that a `MEASURED_IPC` contract or a retention-bearing contract would need.
- **Dead / outdated UI is removed** as an explicit clean-up pass before new build (the version
  picker, the value/number inputs, the Overview tab, unused security panels) — sequenced as
  *refine → clean → upgrade*.

## Status & open items

`accepted`. CD1–CD16 are owner-approved; **CD10's client-billing model is agreed with Eng Ahmed
(2026-09-13)** — the realization model (independently-billable VO invoices grouped into a Billing
Package, a `VariationBillingAllocation` ledger, omissions by stage-reduction/credit-note, phased
P1/P2/P3) is in design doc §7. **Architecture pass done** (`commercial-workspace-redesign-architecture.md`):
CD1–CD5 / CD8 / CD9 / CD13 / CD14 / CD16 need only presentation + thin additive server work; the
variation-billing **Phase 1** needs a small `VariationBillingAllocation` migration (no new aggregate, no
`ClientInvoiceLine`, no credit notes). **Owed:** spec + tickets; ACCO's accountant confirms sales-tax /
credit-note formatting before Phase 2; a committed-BOQ tie-break during the `COMMITTED`/`BASELINED`
overlap (Abdulsalam, non-blocking). Superseding/refining: refines ADR-017 (tab model) and the
contract-creation-form spec; hardens ADR-023 CONST-COM-012; extends ADR-026 with CONST-COM-023..029;
consumes ADR-029's tie-out and committed-BOQ model.
