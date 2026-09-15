# Commercial workspace redesign — subtract to a professional, QuickBooks-clean money surface

**Status:** DRAFT (design) — companion to **ADR-030**. UX/eng decisions owner-approved; **CD10
(variation-into-milestone billing) pending Eng Ahmed**. Architecture + spec + tickets owed.
**Date:** 2026-09-13 · from `/grill-with-docs` on the Commercial workspace.
**Builds on:** ADR-017 (workspace), ADR-023 (milestone billing), ADR-026 (variations), ADR-029 (BOQ
tie-out / committed BOQ), and `commercial-billing-model-refinement.md` (P3, mostly shipped).

The goal in one line: **the same "sticky spine + one next-step" grammar as the BOQ tab**, a form
with almost nothing to fill in, one place for the money story, and a variation you raise the way you
add a line in QuickBooks. Fewer things, working professionally.

---

## 1. The target shell — 4 tabs + a persistent ribbon

For a MILESTONE contract (ACCO's model) the workspace is exactly four tabs, under one ribbon that is
on **every** tab:

```
┌ Office Building · Commercial ────────────────────────────────────────────┐
│ ◉ ACTIVE · Milestone 2 of 4 — blocked: verify "Partition" milestone       │ ← cycle ribbon (CD15)
│                                    [Go verify →]  [Generate invoice ▸(off)]│
├───────────────────────────────────────────────────────────────────────────┤
│  Contract │ ▸Payment Schedule │ Variations │ Billing                       │ ← 4 tabs (CD16)
└───────────────────────────────────────────────────────────────────────────┘
```

- **No Overview tab.** Its "what next" is the ribbon; its money figures move to Billing.
- **No Applications tab** unless the contract is `MEASURED_IPC` (hidden-dormant, CD5).
- The **ribbon** is the "current cycle" read model, lifted out of Overview: `stage · blocker ·
  one action`. The action is live or disabled-*with-a-reason* — never a bare dead button (CD8/CD25).

---

## 2. Contract tab — the agreement, and how it goes live

**Create is almost empty.** Because the BOQ tie-out fixes the value and the project code fixes the
number, the form collapses to **client + dates** (billing model defaults to Milestone):

```
┌ New contract ───────────────────────────────────────────────────────┐
│ Client        [ACCO Development Co ▾]                                │
│ Contract value   $528,000   ← from the committed BOQ (read-only, CD2)│
│ Contract number  ACCO-WBR-26-0065-C1   (auto, CD3)                   │
│ Start [__]   Expected completion [__]                               │
│ Billing model  ◉ Milestone   ○ Measured (IPC)                       │
│                                          [Cancel]   [Create ▸]       │
└─────────────────────────────────────────────────────────────────────┘
   No committed BOQ → the form is replaced by:  "Commit the BOQ first →"  (CD1)
```

**Going live is a next-step button, not a mystery.** The DRAFT→ACTIVE rail becomes a quiet indicator;
one button drives it (CD6):

```
Status  DRAFT ──○── UNDER REVIEW ──○── PENDING SIGNATURE ──○── ACTIVE
                                                    [ Advance contract ▸ ]   ← Submit / Approve / Execute
```

Retention & advance-recovery sections appear **only if configured** (CD4). Guarantees (performance
bonds) stay as a compact section: add / edit / discharge, with expiry attention.

---

## 3. Payment Schedule — the 40/30/20/10, done professionally

```
┌ Payment Schedule ────────────────────────────────────────────────────────┐
│ Contract $528,000   (+$2,000 variations → $530,000)          plan 100% ✓  │
│  1 Structure / Advance    40   211,200   PAID                             │
│  2 Partition & Plaster    30   158,400   ⛔ verify "Partition" milestone →│ ← blocker ON the row (CD8)
│     └ + VO-001 Extra lift shaft          +2,000   client-approved         │ ← partnered sub-line (CD10)
│       Milestone 2 total                 160,400                           │
│  3 Install & Paint        20   105,600   UPCOMING                         │
│  4 Inspect & Handover     10    52,800   UPCOMING                         │
│                                                        [ Edit plan ]      │
└───────────────────────────────────────────────────────────────────────────┘
```

- **The gate explains itself on the row** (CD8): the disabled *Generate invoice* sits next to
  `⛔ verify "Partition" milestone →`, a real link to Progress. No dead buttons.
- **The editor is honest** (CD9): Save is **blocked** until the editable rows reconcile (100% DRAFT;
  `100 − invoiced%` ACTIVE). Invoiced rows are hard-**locked** under a `70% already billed — editing
  the remaining 30%` header.

---

## 4. Variations — raise money the QuickBooks way

**Raising is one small drawer** — describe it, put a sign and amount on it, choose where it bills:

```
        ┌ Add variation ─────────────────────┐
        │ What changed [_________________]    │
        │ Amount   ○ addition  ○ omission     │
        │          $[______]                  │
        │ Bill with  [Milestone 2 ▾]   or     │  ← un-billed installments only (CD10)
        │            [Bill separately]        │
        │ Time impact [__] days (optional)    │
        │             [Cancel]      [Add ▸]   │
        └─────────────────────────────────────┘
```

**The billing model (CD10 — the rule Eng Ahmed must confirm):**

- An approved variation is **partnered to one chosen un-billed installment** and shows as an
  **itemised sub-line** on that installment's invoice. `Milestone 2: 150,000 + VO-001 2,000 = 152,000`.
- The base **40/30/20/10 stays frozen on `baseContractValue`** — the partnered line is *additive*, it
  does not re-spread the schedule. `contractValue` (current) still rises by the net (ADR-029 V-2).
- **The user picks the milestone every time**; the picker offers only **un-billed** installments plus
  **"Bill separately"**. A variation approved after all its milestones are billed → *standalone line*
  (never stuck).
- An **omission** partners symmetrically as a negative sub-line (CD12).
- **Needs a schema change (architecture-pass correction):** `stageInstallmentId` is today only a
  read-model placeholder (hard-coded `null`), not persistence, and `ClientInvoice` is header-only.
  Partnering needs a persisted `VariationOrder → installment` link **plus** an itemised invoice line —
  a new `ClientInvoiceLine` table (**Option A**) or a separate co-presented invoice (**Option C**);
  folding into the milestone subtotal is UNSAFE (CONST-BOQ-032 / CONST-VAR-008). See
  `commercial-workspace-redesign-architecture.md`.

**The list answers "invoiced?" inline** (CD11):

```
 Ref     What                Amount   Bills with     Client      Invoiced?
 VO-001  Extra lift shaft    +2,000   Milestone 2    approved    ✓ on INV-002
 VO-002  Facade change      +12,000   —              pending     —
```

---

## 5. Billing — the one money story, made attractive

Everything about *getting paid* lives here (CD13, CD14): the money story
`Contract value → Invoiced → Collected → Outstanding` and a **collected-vs-invoiced cashflow curve**
as the hero, with aging beneath.

```
┌ Billing ─────────────────────────────────────────────────────────────────┐
│ Contract $530,000 · Invoiced $211,200 · Collected $211,200 · Outstanding $318,800 │
│  ╭ Collected vs invoiced ────────────────╮   Aging  ▇ current  ▁ 30+  ▁ 60+  ▁ 90+│
│  │        ___/‾‾‾ invoiced                │                                       │
│  │     __/   __/‾ collected               │   Invoices …    Receipts …            │
│  ╰────────────────────────────────────────╯                                       │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Subtract first — the clean-up pass (before any new build)

Removed / demoted (owner: *"remove a lot of things"*):

| Remove / demote | Why | Rough location |
|---|---|---|
| BOQ-version picker in the contract form | No user-facing versions (ADR-029) | `contract-form.tsx`, contract-creation-form spec |
| Contract-value input | It is the tie-out (CD2) | `contract-form.tsx` |
| Contract-number input | Auto from project code (CD3) | `contract-form.tsx` |
| **Overview tab** | Ribbon + Billing absorb it (CD16) | `commercial-nav.tsx`, `overview-tab.tsx`, routes |
| Retention / advance panels (default) | ACCO uses neither (CD4) | `contract-security-tab.tsx` |
| Applications tab for MILESTONE | Measured-only (CD5) | `commercial-nav.tsx` (already gated) |
| "Security" in the tab name | → "Contract" (CD4) | `commercial-nav.tsx` |

Sequence, per owner: **refine (this doc + ADR-030) → clean the dead/outdated code → upgrade
(build the ribbon, the partnering, the polish, the chart).**

---

## 7. Variation billing model — LOCKED 2026-09-13 (Eng Ahmed + owner)

**Spine:** a variation is an **independently-billable commercial unit**; contract **entitlement** and
billing **realization** are separate layers; every approved variation dollar is realized **exactly
once**.

**Three layers:**
1. **Entitlement (already built, ADR-029 V-2):** `base (frozen) + Σ approved VO net = current contract
   value`. Drives no document — it is what the client owes in total.
2. **Billing realization (new, thin):** a **`VariationBillingAllocation`** ledger ties each VO dollar
   to how it was billed. Invariant `Σ allocations for a VO == VO.netValue` — **CONST-COM-028**.
3. **Documents (mostly existing):** `ClientInvoice` (header-only, **reused**) grouped into a **Billing
   Package projection** (no new aggregate); `CreditNote` (new, Phase 2); `ClientInvoiceLine` (Phase 3,
   only if same-document billing is later wanted).

**Document shape = Option C now, not Option A.** A variation bills as its **own `ClientInvoice`** via
the existing `generateFromSeparateCharge` path, tagged to the installment + variation, grouped with the
milestone invoice as one "Milestone N Billing" package. Option A (one itemised invoice) is a **Phase-3**
cosmetic merge — the allocation + grouping key survive it, so no repaint. Rationale (agreed): ACCO's
**pay-now-or-later** flow *requires* independently-billable units; a deferred variation degrades Option A
to Option C anyway; and separate documents keep a disputed $2k off the back of an undisputed $158k.

**Billing flow:** at *"Bill this stage"*, ACCO includes or defers each eligible client-approved variation
(per what the client agreed to pay now); the system generates the milestone invoice + the chosen VO
invoices, grouped.

**Omissions — trigger is INVOICED, not PAID (CONST-COM-029):**
- stage **not yet invoiced** → reduce that stage's invoice (`STAGE_REDUCTION` allocation);
- stage **already invoiced** → a **credit note** against the immutable original (`CREDIT_NOTE`, Phase 2);
- a **split** omission (part billed, part not) → both treatments; the invariant makes them sum to the VO.

**Agreed answers to the original sub-questions:** (a) partnering acceptable — **yes**, as independently
billable units grouped for presentation; (b) A vs C — **Option C now**, A deferred to Phase 3;
(c) omission — **both** (negative line before invoicing, credit note after). Plus: `billingTreatment`
default **WITH_STAGE** (overridable to STANDALONE); a client-approved VO is **independently billable**
(its "certification" is the client's approval, not the stage's site-verification); tax is a generic
engine surfaced as **"Sales Tax 5%"** for ACCO (the field is `vatAmount` today — relabel the surface).

**Frozen rules (→ CONST-COM-027..030):** VO approval moves current value, never the signed 40/30/20/10
baseline · a client-approved VO is independently billable, WITH_STAGE or STANDALONE chosen at billing
time · positive VO → its own invoice in the package · omission before invoicing → stage reduction ·
omission after invoicing → credit note (never amend the original) · one VO may split across treatments,
Σ allocations == netValue · full trace Variation → Allocation → Invoice/CreditNote → Receipt/Refund.

**Phasing:** **P1 (now, ~existing primitives)** — `billingTreatment` + include/defer billing + VO-as-invoice
via `generateFromSeparateCharge` + the allocation ledger (`INVOICE` + `STAGE_REDUCTION`) + billing-package
projection + Sales-Tax label. **P2 (when an already-invoiced omission occurs)** — `CreditNote` +
`CREDIT_NOTE` treatment + tax reversal + AR credit/refund. **P3 (only if same-document billing confirmed)**
— `ClientInvoiceLine`.

**Still owed (not a Phase-1 blocker):** ACCO's accountant to confirm Somali **sales-tax + credit-note
statutory formatting** before Phase-2 compliance is encoded.

---

## 8. Open items / next steps

1. **Architecture pass — DONE 2026-09-13** (`commercial-workspace-redesign-architecture.md`): confirmed
   the ribbon is a *lift* of the existing current-cycle read model and the 4-tab / Overview-retirement is
   presentation-only.
2. **CD10 billing model — AGREED 2026-09-13 (Eng Ahmed + owner)** — see §7. The build is the P1 slice
   (Option C + allocation ledger); no aggregate, no `ClientInvoiceLine`, no credit notes in P1.
3. **Spec + tickets** — sliced like the BOQ redesign (subtract → shell/ribbon → variation-billing P1 →
   payment-schedule polish → billing chart), + the small `VariationBillingAllocation` migration.
4. **Owed (non-blocking):** ACCO's accountant confirms Somali sales-tax + credit-note formatting before P2.
