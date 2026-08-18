# Commercial Workspace — refinement spec (billing-model-aware)

Status: **Frontend build-ready. Backend read models are already built and green.**
Owners: Frontend — frontend engineer · Backend — Abdulsalam · Domain — Eng Ahmed Shirie
Source of truth: **ADR-023** (billing models). Companion: `contract-creation-form-spec.md`.

## Purpose

The commercial workspace was built entirely around the **certified-progress (IPA→IPC)** model. ACCO's
primary model is a **negotiated payment schedule** (`billingModel = MILESTONE`). The workspace must
**branch on `billingModel`** so a payment-schedule contract shows its **payment plan**, not the IPA
chain — and so retention/advances (which ACCO does not use) disappear.

`billingModel` values: **`MILESTONE`** = payment schedule · **`MEASURED_IPC`** = certified progress.

## Backend contract (already built — no backend gap)
- `GET …/commercial/current-cycle` (`useCommercialCurrentCycle`) now returns, for a MILESTONE
  contract: `stage: 'MILESTONE_SCHEDULE'` and **`paymentSchedule`** —
  `{ currency, contractValue, totalCollected, installments[] }` where each installment is
  `{ id, sortOrder, name, percentage, amount, amountPaid, triggerType, milestoneLabel, dueOffsetDays,
  dueDate, status }` and `status ∈ PAID | PARTIALLY_PAID | BILLED | NEXT | UPCOMING` — derived from
  each installment's **own linked invoice** (`ClientInvoice.sourceInstallmentId`), not a waterfall.
  Monetary fields are `null` without `financialPositionView`; `percentage` + `status` always present.
- The commercial **summary** already carries `billingModel`.
- Types in `@erp/types`: `CommercialCycleStage` (adds `MILESTONE_SCHEDULE`), `PaymentInstallmentBillStatus`,
  `CommercialPaymentSchedule`, `CommercialPaymentScheduleInstallment`, `CommercialCurrentCycleResponse.paymentSchedule?`.

## 1. Navigation — billing-model-aware tabs
`commercial-nav.tsx` `CommercialTab`: `overview | contract-security | applications | billing-collection`.

| Tab | Change |
|---|---|
| **Overview** | keep |
| `contract-security` → **"Contract & Terms"** | rename; include the **payment plan** (for MILESTONE) + guarantees; **drop the retention/advances sub-view** (ACCO uses neither) |
| **Applications** (IPA→IPC) | **hide when `billingModel === 'MILESTONE'`** — render nothing / omit the tab |
| **Billing & Collection** | keep; for MILESTONE it lists installments→invoices→receipts, for IPA it lists IPC→invoices→receipts |

## 2. The cycle band — branch it (`current-payment-cycle.tsx`)
Today it renders a hardcoded 8-stage IPA stepper (`STAGES`) regardless of `stage`. Branch:
- `stage === 'MILESTONE_SCHEDULE'` → render the new **`MilestonePaymentPlan`** (see §4).
- otherwise → the existing 8-stage stepper, unchanged.

## 3. Overview tab (`overview-tab.tsx`) — the guided cockpit
Current panels: `CurrentPaymentCycle` · `CommercialSummaryStrip` · Attention · **MainContract · Certification · RetentionAdvances** | **Receivables · Guarantees · Activity**.

Refinements:
1. **Cycle band branches** (via §2) — MILESTONE shows `MilestonePaymentPlan`, not the stepper.
2. **Delete the `RetentionAdvancesPanel`** from the Overview — dead for ACCO (ADR-023).
3. **Render `CertificationPanel` only when `billingModel === 'MEASURED_IPC'`** — hide for MILESTONE.
4. **`CommercialSummaryStrip` is model-aware:** MILESTONE → *value · collected · outstanding · collection %*
   (from `paymentSchedule.totalCollected / contractValue`); IPA → the certified→invoiced→received chain.
5. **Keep unchanged:** `MainContractPanel` (already shows `billingModel`), `ReceivablesPanel`,
   `GuaranteesPanel`, `CommercialActivity`, the Attention list.

Refined layout:
```
┌─ Cycle band ──────────────────────────────────────────────┐
│  MILESTONE → MilestonePaymentPlan   |   IPA → 8-stage      │
└───────────────────────────────────────────────────────────┘
Summary strip:  Value $4.82M · Collected 40% · Outstanding 60%
Attention (backend-driven)
MainContract         │  Receivables
(Certification: IPA) │  Guarantees / Activity
```

## 4. `MilestonePaymentPlan` — new component
Consumes `paymentSchedule`. One row per installment, in `sortOrder`:
```
PAYMENT CYCLE — Al-Baraka           Contract $4,820,000 · Collected 40%
✓ Advance                40%  $1,928,000  PAID
● Structure              30%  $1,446,000  NEXT           [Generate invoice]
○ Partition & Plastering 20%  $  964,000  UPCOMING
○ Installation & Paint   10%  $  482,000  UPCOMING
```
- Status → icon/tone: `PAID` ✓success · `PARTIALLY_PAID` half · `BILLED` info (invoiced, awaiting payment) ·
  `NEXT` active (show the action) · `UPCOMING` muted.
- **Generate invoice** button on the **`NEXT`** installment only (first un-invoiced) — the `nextAction`
  (`GENERATE_INVOICE`, → `POST /invoices/from-installment`) comes from the read model, gated on
  `canGenerateInvoice`. `BILLED` rows link to their invoice (post/collect), not re-generate. Never auto-bill.
- Money rows hidden (show "—" / restricted) when `amount === null` (no financial permission); percentage
  + status stay visible.
- Mobile 375px: rows stack; keep the action reachable.

## 5. Contract & Terms tab (`contract-security-tab.tsx` → rename)
Today it composes `MainContractTab` + `GuaranteesTab` (already correctly *without* retention/advances).
Rename to **"Contract & Terms"** and add the negotiated **Payment Terms**. The distinction vs Overview:
Overview shows the plan as the **live cycle** (status per installment); this tab shows it as the
**agreement** (read-only "what we signed").

Refined composition:
- **Contract header** — `MainContractTab` (number · client · value · dates · **billing model** · BOQ baseline). Keep.
- **Payment Terms** *(only when `billingModel === 'MILESTONE'`)* — a **read-only** table of the
  negotiated schedule: `name · % · amount · trigger`, with a running **`Σ = 100% ✓`** and a note
  *"changes require a Contract Amendment"* (ADR-023 `CONST-COM-016`). **IPA contracts show no terms table.**
- **Guarantees** — `GuaranteesTab`. Keep.
- **Retention / advances** — stays removed (ACCO uses neither).

Data: **no backend gap** — `ContractResponse.paymentInstallments` (already added) × `contractValue`
for each amount. Component: a small read-only `PaymentTermsTable` (distinct from the live
`MilestonePaymentPlan` on Overview — terms have no status, no Generate-invoice action).

## Deferred (honest)
- **Collection-vs-progress divergence** (ADR-023 CONST-COM-018 — "collected 70% / built 22%") needs
  **verified physical progress** (Programme domain, not built). Overview shows collection now; add the
  divergence overlay when Progress ships.
- Per-installment status is now **exact** (from each installment's linked invoice via
  `sourceInstallmentId`), not a waterfall. What still awaits **Programme** is trigger-based *readiness*
  — i.e. surfacing "this milestone is verified, so it's ready to bill" before the user generates the
  invoice. Today any un-invoiced installment is billable (`NEXT`).

## Frontend files
`components/commercial-nav.tsx` (tabs + hide Applications) · `components/current-payment-cycle.tsx`
(branch) · `components/overview-tab.tsx` (drop retention panel, gate certification, model-aware strip)
· **new** `components/milestone-payment-plan.tsx` · `components/contract-security-tab.tsx` →
rename/repurpose to "Contract & Terms" · remove `components/retention-advances-tab.tsx` usage.
Strings via `next-intl`, **English only** (Arabic retiring). 375px.

## i18n / status keys
Add labels for `MILESTONE_SCHEDULE`, the four `PaymentInstallmentBillStatus` values, "Contract & Terms",
and the `MilestonePaymentPlan` copy under `commercial.*`.
