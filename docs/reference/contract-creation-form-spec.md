# Contract Creation Form — refined spec

Status: **DESIGN / build-ready for the parts noted; payment-plan portion gated on backend
`ContractPaymentPlan` (ADR-023).**
Owners: Backend — Abdulsalam · Frontend — frontend engineer · Domain — Eng Ahmed Shirie
Source of truth: **ADR-023** (billing models), ADR-020 (BOQ is the value source), ADR-022 (authority),
ADR-019 (guarded commands / Preparation).

## Purpose

Refine the contract creation form to ACCO's real billing model. Today the form is flat and captures
`billingModel` as a **dead dropdown with no consequence**, has **no payment plan**, offers non-USD
currency, and **re-keys the contract value** instead of taking it from the BOQ. The refined form makes
`billingModel` the **fork** that shapes the rest, and captures ACCO's negotiated **payment schedule**.

ACCO V1 model (confirmed 2026-08-17): **advance + staged milestone installments summing to 100%.
NO retention. NO advance recovery.** Some clients instead choose **IPA / certified progress**. The
client chooses the model **per contract**.

## Current files
`apps/web/src/features/contracts/components/contract-form.tsx` · `../contract-form-payload.ts` ·
`../types.ts` (`BILLING_MODELS`). New: a `PaymentPlanBuilder` component.

---

## The form — three guided steps

### Step 1 — Contract basics
| Field | Control | Rule |
|---|---|---|
| Project | Select, **required** | From projects. If opened with `?projectId`, prefill + derive client from the project record. |
| Client | Select, **required** | **From the client registry only** — no free text (Stop-2 rule). |
| BOQ version | Select, **required** | **BASELINED versions only** (server rejects others, `contract.service.ts`). |
| Contract value | Input (money), **derived** | **Prefill from the selected BOQ version's baseline total** (ADR-020). Editable; if it differs from the BOQ total, show a **⚠ variance** indicator. |
| Contract number | Input, **required**, ≤50 | Unique → `409` shows "duplicate number". |
| Start / Expected end | Date | `end ≥ start`. |
| Currency | — | **Fixed `USD`** (USD-only decision). Remove the `USD/SOS/AED` picker. |

### Step 2 — Billing model (the client's choice; branches the form)
Segmented control / radio, **required**:
- **Milestone payment schedule** — advance + staged installments (negotiated). *ACCO's common case.*
- **IPA / certified progress** — measured monthly, consultant-certified (IPA → IPC).

`billingModel` is **immutable after creation** (like project/client/BOQ — shown read-only in edit mode).

### Step 3 — conditional on Step 2

**If Milestone → Payment Plan builder.** Pre-filled with ACCO's org default template, fully editable:

| Installment | % | Amount (computed) | Trigger |
|---|---|---|---|
| Advance | 40 | `% × contractValue` | Commencement |
| Structure | 30 | … | Milestone |
| Partition & Plastering | 20 | … | Milestone |
| Installation & Paint | 10 | … | Milestone |
| Inspection & Handover | — | — | Final acceptance *(no payment unless configured)* |

Builder behaviour:
- Each row: **name**, **% (editable)**, **computed amount** (`% × contractValue`, recomputes when value
  changes), **trigger type** (`ADVANCE | TIME_BASED | MILESTONE`), and for `TIME_BASED` a due offset/date.
- **Add / remove** installments.
- **Live invariant: Σ(%) must equal 100%** — show the running total, block submit until it reconciles
  (e.g. a 70%-advance negotiation forces the rest to rebalance).
- **No retention, no advance-recovery fields** (ACCO V1).
- (Later, when Programme ships) a `MILESTONE` installment may **reference a verified programme
  milestone** (ADR-021). For now, a milestone name/label is enough.

**If IPA → no plan.** Show an informational note: *"Billed monthly via IPA → IPC certification. No fixed
schedule."*

### Review → Create
Creates the contract as **DRAFT (Preparation)**. The payment plan is finalised while in Preparation;
**material changes after activation require a Contract Amendment** (ADR-023 `CONST-COM-016`), not editing.

---

## Business rules the form must enforce
- BASELINED BOQ versions only · client from registry only · `USD` only.
- Contract value defaults from BOQ baseline; override is allowed but flagged as variance.
- Payment plan **Σ% = 100%** before submit (mirror the server check).
- `billingModel` and the project/client/BOQ identity are **immutable after creation**.
- Executing the contract later **freezes client details** — keep the existing warning.

## Backend tasks (Abdulsalam)
1. ~~Reconcile `BillingModel`~~ — **decided: keep existing values.** `MILESTONE` = payment schedule,
   `MEASURED_IPC` = certified progress. No breaking rename / data migration. (T&M/HYBRID remain unused.)
2. ✅ **`ContractPaymentInstallment`** built (percentage-only, `PaymentTrigger` enum, sortOrder, due
   offset/date, milestone label). Installments *are* the plan — no separate 1:1 header. Migration
   `20260817..._add_contract_payment_installments` applied.
3. ✅ **`CreateContractDto`** extended with `paymentPlan[]`; **server-side Σ% = 100%** enforced
   (`assertPaymentPlanReconciles`), rejected on non-`MILESTONE` contracts. 3 tests green.
   Types exported from `@erp/types`: `PaymentTrigger`, `ContractPaymentInstallmentResponse`,
   `PaymentInstallmentInput`; `ContractResponse.paymentInstallments` added.
4. ⏳ **Derive `contractValue` from the BOQ baseline** — not yet; the create endpoint still takes a
   value. Frontend can prefill from the BOQ read model for now.
5. ⏳ **Org-level default template** (40/30/20/10) — not built; **frontend hardcodes the default** in
   the builder for now (it's editable anyway).

**Frontend is unblocked:** POST `paymentPlan: PaymentInstallmentInput[]` (percentages as fractions,
Σ=1) on contract create when `billingModel = MILESTONE`; read them back via
`ContractResponse.paymentInstallments`.

## Frontend tasks (frontend engineer)
1. Replace the flat form with the **three-step guided flow**; `billingModel` is the branch.
2. Build the **`PaymentPlanBuilder`** — prefilled default template, editable rows, computed amounts,
   add/remove, **live Σ%=100%** gate.
3. **Remove the currency picker** (USD fixed). Prefill **value from BOQ** (`useBoqWorkspace` already
   loads the BOQ — read the baseline total).
4. Strings via `next-intl`; **English only** (Arabic is being retired per the Round-1 decision — do not
   add `ar`). Form + builder must work at **375px**.

## Gating / sequence
- Step 1–2 refinements (value-from-BOQ, USD-only, billingModel-as-fork) can land first.
- The **Payment Plan builder depends on the backend `ContractPaymentPlan`** (task 2–3) — build the UI
  once the endpoint + types exist.
- Retention / advance-recovery are intentionally **out of scope** (ACCO V1).
