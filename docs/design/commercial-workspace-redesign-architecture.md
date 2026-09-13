# Commercial workspace redesign — architecture pass

**Status:** DRAFT (architecture) — companion to **ADR-030** and `docs/design/commercial-workspace-redesign.md`.
**Date:** 2026-09-13. Grounds every decision cluster (CD1–CD16 / CONST-COM-020..026) against the running code.
**Verdict:** at the end. One line: **DECISIONS REQUIRED** — CD10 is money-critical, needs Eng Ahmed, and its
"itemised sub-line" phrasing does not fit the current header-only invoice model without a schema addition.

**► RESOLVED 2026-09-13 (Eng Ahmed + owner agreed).** The CD10 decisions this pass required are made. Agreed
realization = **Option C** (independently-billable VO invoices grouped into a **Billing Package** projection) +
a small **`VariationBillingAllocation`** ledger (Σ per VO == netValue), omissions by stage-reduction (un-invoiced)
or credit note (invoiced), phased **P1** (allocation ledger, no aggregate/no `ClientInvoiceLine`/no credit notes) →
**P2** (credit notes) → **P3** (Option A `ClientInvoiceLine`, only if same-document billing is later wanted). See
ADR-030 (now `accepted`, CONST-COM-023/027/028/029/030) and design doc §7.

This pass extends the project's Clean Architecture (presentation → application → domain → infrastructure;
Prisma only in infrastructure; read models in the application layer; governed transitions via
`CommandGovernanceService`; audit via the transactional outbox). It does **not** implement.

---

## 0. System boundary & ownership

Three bounded contexts touch this redesign. The ownership lines already exist and must not blur:

| Aggregate / surface | Owner | Where |
|---|---|---|
| `Contract` (+ installments, guarantees, advance/retention terms, deliverables) | Construction / Contracts | `apps/api/src/business/construction/contracts/**` |
| `VariationOrder` (+ lines, at-risk auth) | Construction / Variations | `apps/api/src/business/construction/variations/**` |
| Commercial **read models** (summary / current-cycle / applications / billing / payment-schedule) | Construction / Commercial | `apps/api/src/business/construction/commercial/**` |
| `ClientInvoice` (+ AR posting, receipts, allocations) | Accounting / Accounts-Receivable | `apps/api/src/business/accounting/accounts-receivable/**` |
| BOQ tie-out / committed BOQ / separate charge | Construction / BOQ | `apps/api/src/business/construction/boq/**` |

**Load-bearing fact for CD10:** invoice *generation* lives in **Accounting**, not Construction.
`ClientInvoiceController` is mounted at `@Controller('invoices')`, gated by `receivablesManage`
(`client-invoice.controller.ts:21-22,43-53`), and `ClientInvoiceService.generateFromInstallment`
(`client-invoice.service.ts:140-205`) *reads* a construction installment but *writes* an accounting
`ClientInvoice`. ARCH-BOUNDARY-001 stands: construction depends on accounting, never the reverse. Any
"partner a VO onto an installment invoice" logic that reaches into the VO aggregate must be assembled on the
**construction** side and handed to accounting as data, or the invoice service must be given a construction
**read port** — it cannot import the Variations module.

---

## 1. Contract create simplification — CD1–CD3 / CONST-COM-020/021/022

### 1.1 Current reality (confirmed in code)

- `ContractService.create` (`contract.service.ts:113-225`) **already derives** the value from the committed
  BOQ tie-out for `CLIENT_CONTRACT` via `deriveTieOutValue` (`:238-274`), which calls
  `boqVersioning.getInContractTotal` and rejects a mismatch with `TIEOUT_MISMATCH` (ADR-029 R3). **CD2 is
  therefore form-only for the value itself** — the server already ignores/validates a supplied `contractValue`.
- **But three inputs are still *required* by the DTO** (`create-contract.dto.ts`): `boqVersionId`
  (`:74-77`, `@IsNotEmpty`), `contractNumber` (`:79-82`, `@IsNotEmpty`), and `contractValue` (`:84-86`,
  `@IsDecimal`). The service resolves the BOQ **by the supplied `dto.boqVersionId`** (`:120-133`) and checks
  a **duplicate contractNumber** (`:150-157`). So CD1/CD2/CD3 are **not** purely presentational — the
  create contract requires a server change to stop demanding these three fields.

### 1.2 CD1 / CONST-COM-020 — bind to the single committed BOQ, no picker

- **Where the committed BOQ id comes from:** there is exactly one committed BOQ per project
  (ADR-029 CONST-BOQ-027). The server must **resolve** it, not accept it. Add a repository read
  `findCommittedBoqVersionForProject(projectId)` that returns the single `BoqVersion` whose status ∈
  `COMMITTED_BOQ_STATUSES` (`contract.service.ts:36` — `{ COMMITTED, BASELINED }`) for the project's BOQ.
  - Zero committed versions ⇒ **gate** (`400` / a machine code `BOQ_NOT_COMMITTED`) so the UI renders
    "Commit the BOQ first →" (the design's dead-end replacement). Never an empty dropdown.
  - More than one in `COMMITTED_BOQ_STATUSES` ⇒ this is the R2 migration overlap (`COMMITTED` in-place vs
    legacy `BASELINED`). The resolver must pick deterministically (prefer `COMMITTED`; there should be one
    operational version). **Surface this as an invariant risk** (see §9) — it is a real ambiguity the current
    create sidesteps by trusting the caller's id.
- **Invariant CONST-COM-020 (new):** a `CLIENT_CONTRACT` binds to the project's server-resolved committed BOQ;
  `boqVersionId` is **removed from the create DTO**. Reinforces ADR-029 I-1.

### 1.3 CD2 / CONST-COM-021 — value is the tie-out, read-only

- `contractValue` is **removed from the create DTO**. The service already sets both `baseContractValue` and
  `contractValue` from the tie-out (`:191-194`). `deriveTieOutValue`'s "supplied value must equal tie-out"
  branch (`:255-271`) becomes dead once the input is gone — keep the derive, drop the equality check, keep the
  `null`/no-priced-scope guard (`:247-251`).
- **SUBCONTRACT unaffected:** the non-tie-out branch (`:145-148`) keeps its supplied value. CONST-COM-021
  is scoped to `CLIENT_CONTRACT`. The create DTO must therefore still accept a value for `SUBCONTRACT`
  (make it *conditionally* optional, or split the DTO) — do not blanket-remove the column.

### 1.4 CD3 / CONST-COM-022 — auto contract-number from the project code

- **Pattern already exists:** ADR-025 project codes are minted with an atomic per-(org, year) upsert-increment
  in `project-prisma.repository.ts:203-211` (`ProjectCodeSequence`, `nextValue: { increment: 1 }`,
  `padStart`). Mirror it exactly.
- **Design:** a new per-**contract-parent** sequence. The design wants `ACCO-WBR-26-0065 → …-C1`, i.e. suffix
  `-C{n}` on the **project code** (`Project.code`, `schema.prisma:568`). Because a project has at most one
  effective `CLIENT_CONTRACT` at a time but may have had CLOSED/CANCELLED predecessors (`:175-183`), the
  number must be **stable and non-colliding across the project's lifetime**, so a monotonic per-project
  counter is correct (never "always C1").
  - **Which layer mints it:** the **infrastructure** layer (repository), inside the existing create
    `$transaction` (`:171`), exactly like `allocateCode`. The application service asks the repo for the next
    number; the repo does the atomic increment. Do **not** mint in the service (no Prisma there) or controller.
  - **Sequence + collision guard:** add a `ContractNumberSequence` keyed `@@id([projectId])` (or reuse a
    generic per-parent counter) incremented atomically; format `${project.code}-C${n}`. The **existing
    `findByNumber` duplicate check** (`:150-157`) stays as the backstop, backed by the existing
    `@@unique([organizationId, contractNumber])`-style guarantee (contract numbers are unique per org —
    confirm/keep the unique index). Idempotency: minting inside the create transaction means a rolled-back
    create does not burn a number visibly; a burned number on retry is acceptable (gaps are fine, exactly as
    project codes tolerate gaps).
  - `contractNumber` is **removed from the create DTO**; `update()` may still allow an admin correction
    (`:389-429` already supports it) — out of scope for the create simplification.

### 1.5 Endpoints / DTOs changed (cluster 1)

- **`POST /contracts` (`CreateContractDto`)**: remove `boqVersionId`, `contractValue`, `contractNumber` for
  `CLIENT_CONTRACT`. Keep `projectId`, `clientId`, `currency`, `billingModel` (default MILESTONE per CD-consequences),
  `startDate`, `expectedEndDate`, `paymentPlan?`. SUBCONTRACT keeps `contractValue`.
- **New repo reads:** `findCommittedBoqVersionForProject`, `nextContractNumber` (atomic).
- **New machine codes:** `BOQ_NOT_COMMITTED` (gate), keep `TIEOUT_MISMATCH` internally.
- **Migration:** additive `ContractNumberSequence` table; **no** change to `Contract` columns. Backward
  compatible — existing contracts keep their numbers.

**Cluster 1 verdict: sound, form + thin server change. No invariant conflict.** One risk logged (§9-R1: the
multi-committed-version resolver tie-break).

---

## 2. 4-tab shell + ribbon + Overview retirement — CD4/CD5/CD15/CD16 / CONST-COM-025/026

### 2.1 The ribbon is a lift, not a rebuild

`getCurrentCycle` (`commercial.service.ts:650-781`) **already** produces `stage · nextAction · blockers` for
**both** billing models and for the pre-active/terminal/no-contract states:

- No contract → `stage: 'NO_CONTRACT'`, `nextAction: CREATE_CONTRACT`, `blockers:['MAIN_CONTRACT_MISSING']`
  (`:662-677`).
- Not ACTIVE → `stage: 'CONTRACT_DRAFT'`, next action EDIT/ADVANCE (`:704-725`). **This is CD6's "Advance
  contract" driver — the read model already emits it.**
- **MILESTONE** → `stage: 'MILESTONE_SCHEDULE'` with the full `paymentSchedule` and a `GENERATE_INVOICE`
  next action gated on `hasFocus && canGenerateInvoice` (`:729-748`).
- MEASURED_IPC → the IPA-chain projection (`:751-780`).

So the ribbon **consumes the existing `current-cycle` read model** on every tab. **CONST-COM-025 is satisfied
by an existing endpoint** — no new read model for the ribbon itself.

### 2.2 The one real gap — the blocker reason is not on the ribbon for MILESTONE

The MILESTONE branch returns **`blockers: []`** (`:743`). The blocking reason ("verify Partition milestone")
lives *inside* `paymentSchedule.installments[].programmeMilestone.status` (`:1047-1054`), not lifted to the
ribbon's `blockers`/`nextAction`. The ribbon mock (`…redesign.md` §1) shows
`blocked: verify "Partition" milestone` **on the ribbon**. To honour CD8/CD15 the `current-cycle` MILESTONE
branch must **derive the focus installment's blocker** and put it on `nextAction`/`blockers` (e.g. a
`MILESTONE_UNVERIFIED` blocker + a remediation href to Progress). This is a **small application-layer change to
`buildPaymentSchedule` + the MILESTONE branch of `getCurrentCycle`**, no schema, no new endpoint. See §4.

### 2.3 What Overview consumes that must move (CD16)

`overview-tab.tsx:11-15,54-70` composes, all from `summary` (`GET …/commercial/summary`) + `current-cycle`:
`ContractPositionBand`, `OtherCommercialItemsBand`, `CurrentPaymentCycle`, `AttentionList`,
`PaymentPlanOrCertification`, `CommercialActivity`. Relocation is **presentation-only**:

- Position bands (contract value / invoiced / collected / outstanding), aging, activity → **Billing** tab
  (they already come from `getSummary` / `getBilling`).
- "What next" (cycle card) + attention → **ribbon** (already `current-cycle`).
- `PaymentPlanOrCertification` → the **Payment Schedule** tab (already `getSummary`/`getBilling`).

**No read-model consolidation or endpoint change is required** to retire Overview — the two endpoints Overview
uses (`summary`, `current-cycle`) are consumed by the surviving tabs. The retirement is: delete `overview-tab.tsx`
and the Overview route, drop `'overview'` from `commercialTabsFor` (`commercial-nav.tsx:51-59`), and repoint the
tab base href (currently `overview` maps to the bare `/commercial` base, `:61-64`) to Contract or Billing.

### 2.4 CD4/CD5 — hiding Applications/retention/advance is presentation-only

- `commercialTabsFor` **already** hides Applications for MILESTONE and shows Payment Schedule instead
  (`:54-58`) — CD5/CONST-COM-026 for the Applications tab is **already true**; the redesign only removes
  `'overview'` and renames `'contract-security'` → Contract label.
- The **server** already reports retention/advance as **not applicable** for MILESTONE:
  `securityPosition.applicable = contract.billingModel !== 'MILESTONE'` (`commercial.service.ts:1146`), and
  `retention` is null unless configured (`:501-507`). So CD4 (render retention/advance **only when
  configured**) is a **presentation gate over data the server already nulls** — no backend change.
- `MEASURED_IPC` retains the Applications surface and the measured path in code (CD5) — nothing deleted.

### 2.5 Cluster 2 endpoints / DTOs

- **No new endpoints.** One application-layer enrichment to `getCurrentCycle`/`buildPaymentSchedule` to lift the
  MILESTONE blocker onto the ribbon (§2.2 / §4).
- Frontend: `CommercialTab` union drops `'overview'`; routes retire the Overview page.

**Cluster 2 verdict: sound, mostly presentation. One small application-layer enrichment (ribbon blocker).**

---

## 3. THE MONEY-CRITICAL ONE — variation → milestone partnering — CD10/CD11/CD12 / CONST-COM-023

This is the crux, and it is where the redesign's stated assumption ("no schema change; the `stageInstallmentId`
seam already exists") is **partly wrong**. Precise findings:

### 3.1 Does the `stageInstallmentId` seam exist with NO schema change?

**No — not as persistence.** `stageInstallmentId` exists **only** as a nullable field on the *read-model type*
`CommercialPaymentScheduleVariationLine` (`packages/types/src/construction.ts:1722-1731`), and it is **hardcoded
`null`** where the read model is assembled (`commercial.service.ts:1074`). There is **no column** on
`VariationOrder` (schema `:1571-1632`), no relation to `ContractPaymentInstallment`, and nothing persists it. The
ADR-030 text "carried on the variation's existing `stageInstallmentId` billing seam (ADR-029 R7)" and the design
doc's "No schema change expected" are **inaccurate at the storage layer**: the seam is a *documented placeholder in
a response type*, not a durable relation.

**Therefore a schema change IS required** to partner a VO to an installment: a new nullable relation
`VariationOrder.stageInstallmentId → ContractPaymentInstallment.id` (`onDelete: SetNull`, indexed). This is the
minimal, additive change; it does **not** touch `Contract`, `ClientInvoice`, `IpaItem`, `IpcItem` (preserving
CONST-VAR-008's "no tag threaded through the certify chain"). The read model then reads the real column instead of
`null` (`:1074`).

### 3.2 How does invoice generation incorporate the partnered line? (the hard part)

**The invoice is header-only.** `ClientInvoice` has **no line-item table** (schema `:2494-2556`); it stores a single
`subtotal`/`vatAmount`/`totalAmount` and posts a 2–3 line GL journal Dr AR / Cr Revenue / Cr VAT
(`client-invoice.service.ts:346-404`). `generateFromInstallment` writes `subtotal = base × percentage`
(`:172-178`) — a single figure, no itemisation. `create()` in the repo takes only those three money fields
(`client-invoice.repository.ts:127-158`).

So CD10's "**itemised sub-line** on that installment's invoice (`Milestone 2: 150,000 + VO-001 2,000 = 152,000`)"
**cannot be expressed by the current invoice model.** There are three shapes; the choice is an ADR-worthy decision
and part of what Eng Ahmed must confirm:

- **Option A — add a `ClientInvoiceLine` child table (RECOMMENDED for CD10 as written).** The installment invoice
  gains lines: a base line (`base × pct`) and one partnered VO line (`net`, negative for an omission). `subtotal`
  becomes `Σ lines` = `(pct × base) + Σ partnered-VO-net`; VAT/total derive from it. This is the *only* shape that
  literally produces the "itemised" invoice the owner drew and keeps the VO a **named, identifiable line on the
  invoice**. Cost: a new table + `generateFromInstallment` builds 1..N lines instead of one figure, and the GL
  post can stay a single Revenue credit (line detail is a document concern, not necessarily a GL concern) — so AR
  posting is undisturbed. **This is a genuine model extension, not "wiring an existing seam."**
- **Option B — fold the VO net into the installment `subtotal`, no itemisation.** Smallest change, but it
  **violates CONST-VAR-008 / ADR-029 CONST-BOQ-032** ("each variation separately identifiable … never merged into
  the milestone amount"). The invoice would read one blended figure; the VO stops being separately identifiable on
  the receivable. **UNSAFE against the standing invariant** — do not choose without Eng Ahmed explicitly
  superseding CONST-BOQ-032 (which ADR-030 says CD10 does — but only for *presentation as a sub-line*, not for
  *erasing* the line).
- **Option C — keep the VO a **separate** `ClientInvoice` (its own `sourceBoqNodeId`/variation source) and only
  *co-present* the two invoices under "Milestone 2" in the UI.** No new table; strongest audit separation
  (one receivable per source, matching the existing separate-charge path `:226-293`). But it does **not** produce a
  single itemised invoice document — the client receives two documents shown together. If ACCO's clients accept
  "milestone invoice + attached variation invoice," this is the lowest-risk shape and reuses the idempotent
  one-source-one-invoice pattern verbatim. **This is the real question for Eng Ahmed (CD10a).**

**The base %-schedule stays frozen regardless:** all three keep `installmentAmount = pct × baseContractValue`
(`client-invoice.service.ts:172-175`), and `contractValue`(current) still = `base + Σ adopted VO net` via
`raiseCurrentValueForVariation` (`contract.service.ts:448-488`). ADR-029 V-2 is preserved in every option.

### 3.3 The "bills exactly once" invariant (CONST-COM-023, must be enforced server-side)

A partnered VO must bill **exactly once — on its installment XOR standalone, never both, never on an already-billed
installment**. Today `variationLines` are emitted for **every** adopted VO with `stageInstallmentId: null`
(`:1062-1076`) — i.e. today every adopted VO is a standalone line and none is billed through the installment path.
The new invariant set (extends CONST-COM-023):

1. **Partner target must be un-billed.** Assigning `stageInstallmentId = X` is legal only if installment X has **no
   `ClientInvoice`** yet (`ContractPaymentInstallment.clientInvoice` is null, schema `:1510`). If X is already
   invoiced → `409 INSTALLMENT_ALREADY_BILLED`.
2. **Partner target must belong to the same contract** as the VO (guard like `setInstallmentMilestone`
   `contract.service.ts:96-99`).
3. **Bill-once at generation.** When `generateFromInstallment` runs for installment X (Option A), it includes
   partnered VOs whose `stageInstallmentId = X` **and** which are `CLIENT_APPROVED` + adopted (`boqAppliedAt` set)
   **and** not already billed on another installment. The idempotent `@unique(sourceInstallmentId)` guard
   (`:2505`) makes the *installment* invoice idempotent; the VO's "billed" state is then *derived* from
   "its `stageInstallmentId`'s invoice exists" (Option A/B) or "its own invoice exists" (Option C) — no separate
   "billed" boolean on the VO (avoid a second source of truth).
4. **Standalone path unchanged.** A VO with `stageInstallmentId = null` bills standalone (its own line / its own
   invoice), exactly as `variationLines` does today.
5. **Omission (CD12).** A negative-net VO partners as a **negative** line/figure; `net < 0` reduces the installment
   subtotal. Guard: the resulting installment subtotal must not go **negative** (a `−3,000` omission on a
   `−0` future installment) → reject with `PARTNER_WOULD_MAKE_INVOICE_NEGATIVE`. (Eng Ahmed CD10b: is a
   negative *milestone line* acceptable, or must omissions be credit notes?)
6. **Re-profiling interaction.** `replacePaymentPlan` (`contract.service.ts:296-347`) **deletes and rewrites
   un-invoiced installments** (`reprofileUninvoicedInstallments` `:322`). A VO partnered to a **deleted** un-invoiced
   installment would be orphaned. Rule: on re-profile, any `stageInstallmentId` pointing at a removed installment
   must be **cleared to null** (→ reverts to standalone) inside the same transaction, and audited. The `onDelete:
   SetNull` on the new relation makes this safe at the DB level, but the service must also re-derive so the UI never
   shows a dangling partner.
7. **Unlink/re-profile a partner.** Un-partnering (set `stageInstallmentId` back to null) is legal only while the
   target installment is **un-billed** (same guard as #1). Once billed, the pairing is frozen (immutability, like an
   issued IPC).

### 3.4 Transaction & authorization boundaries (cluster 3)

- **Assigning a VO to an installment (the new "partner" command).** Owner: **construction / Variations** (it mutates
  a `VariationOrder` field). Authorization: reuse `contractsManage` (the same scheme guarding `setInstallmentMilestone`
  and VO edits — VO edits are `assertContract`-gated). One `$transaction`: set `stageInstallmentId`, write a
  `VARIATION_ORDER_PARTNERED_TO_INSTALLMENT` audit event via the outbox (`variation-order.service.ts` pattern
  `:495-510`). Guards: VO must be `CLIENT_APPROVED` (frozen figures, CONST-VAR-010) and adopted; installment un-billed
  and same-contract.
- **Generating the partnered invoice.** Owner: **accounting** (`ClientInvoiceService.generateFromInstallment`), gated
  by `receivablesManage` (`client-invoice.controller.ts:21`). Because accounting must not import Variations, add a
  **construction read port** (interface in accounting's application layer, implemented in construction — mirrors
  `ACCOUNTING_POSTING_PORT` `:14-16`) that returns "the partnered VO lines for installment X" (ref, title, net).
  `generateFromInstallment` composes base line + partnered lines in **one `$transaction`** and creates the invoice
  atomically (Option A). Idempotency unchanged (`@unique(sourceInstallmentId)`, P2002 → return winner `:197-204`).
- **Failure semantics.** VO approved *after* all its milestones are billed → the partner target list is empty → it
  falls back to **standalone** (design's "never stuck"). A partner assignment that races a milestone getting billed →
  the un-billed guard (#1) rejects at assign time or at generate time (whichever loses), never double-bills.

### 3.5 CD11 — the "Invoiced?" chip

**Answerable from an existing read model — no new projection.** `certifiedInvoicedByVariation`
(`variation-order.service.ts:122-202`, route in `variations.controller.ts`) already returns invoiced-to-date **per
VO** via `boqNodeId → sourceChangeOrderId → VariationOrder` (CONST-VAR-008). For the partnered path, "invoiced?" is
additionally answerable as "does this VO's `stageInstallmentId`'s installment have a posted invoice" (Option A/B) or
"does the VO's own invoice exist" (Option C). The chip can be assembled in the Variations list read
(`listForContract` `:65-96`) by joining the per-VO invoiced figure — **presentation/read-assembly only**, no schema.

**Cluster 3 verdict: MONEY-CRITICAL. Requires (a) Eng Ahmed on CD10/CD10a/CD10b, (b) a schema addition
(`VariationOrder.stageInstallmentId`), and (c) an invoice-model extension (`ClientInvoiceLine`) if the invoice must
be literally itemised. The "no schema change" premise is false. See §9 risks.**

---

## 4. Payment-schedule polish — CD8/CD9 / CONST-COM-024/025

### 4.1 CD8 — blocker reason on the row (presentation, with the §2.2 ribbon lift)

The per-installment blocker **is already in the read model**: `installments[].programmeMilestone.status`
(`commercial.service.ts:1047-1054`) and `generateFromInstallment`'s soft gate rejects an unverified milestone
(`client-invoice.service.ts:166-170`, CONST-COM-011). So rendering `⛔ verify "Partition" milestone →` **on the row**
is presentation over existing data. The only server touch is §2.2 (lift the focus blocker onto the ribbon too).
CONST-COM-025 ("reason + remediation at the point of action") is satisfied by existing data on the row; the ribbon
just mirrors it.

### 4.2 CD9 — hard-stop editor (client gate mirrors an existing server gate)

The server **already hard-gates** reconciliation: `replacePaymentPlan` → `assertPaymentPlanReconciles`
(`contract.service.ts:319, 356-387`) throws `400` unless `Σ editable % + frozenInvoiced % = 100%`, and
`findInvoicedInstallments` supplies the frozen total (`:315-317`). Invoiced installments are **frozen** by
`reprofileUninvoicedInstallments` (only un-invoiced rows are rewritten, `:322`). So CD9 is **client-mirrors-server**:
the editor must (a) block Save at `≠ required total` (`100` for DRAFT; `100 − invoiced%` for ACTIVE — the server's
exact rule `:376-386`), and (b) render invoiced rows locked/immutable. **Gap to name:** the client must read the
**frozen-invoiced percentage** to compute `100 − invoiced%`; today the read model exposes installment `status`
(`BILLED/PAID/...`) per row (`:1020-1027`) but not an explicit "editable target %." The client can derive it
(sum % of non-`NEXT/UPCOMING` rows), or the payment-schedule read model can add an explicit
`editableTargetPercentage` field for safety. Recommend the explicit field (small additive read-model change) so the
client gate cannot drift from the server's `frozenTotal`.

**Cluster 4 verdict: sound. Presentation + optional one additive read-model field. No invariant conflict; CD9
hardens ADR-023 CONST-COM-012 exactly as intended.**

---

## 5. Billing money story + cashflow chart — CD13/CD14

`getBilling` (`commercial.service.ts:798-960`) already returns the full money story
(`position.invoiced/collected/outstanding/overdue/collectionRate` `:932-945`), the **aging buckets** (`:949-956`),
and per-invoice + per-receipt rows with dates (`:876-924`). So **CD13's money story and aging are already served.**

**CD14 (collected-vs-invoiced curve) needs a time series that does not exist yet.** `getBilling` returns
point-in-time totals and raw rows, but **no cumulative time series** of invoiced vs collected. Two options:

- **Compute the curve client-side from the existing rows** — the invoice rows carry `invoiceDate` and each has
  `paidAmount`; receipts carry `receiptDate` and allocations carry `allocationDate` (`:916-922`). A cumulative
  invoiced-by-date and collected-by-date curve is derivable in the browser from data the endpoint **already
  returns**. Zero backend change. (Preferred first cut — matches "the frontend displays backend numbers" without a
  new endpoint.)
- **Add a server-built `cashflowSeries` to `CommercialBillingResponse`** if the curve must be authoritative/paged
  or aggregated over many invoices. Additive read-model field; no schema.

**Cluster 5 verdict: money story + aging already served; the cashflow curve is derivable from existing rows
(no new endpoint needed) or a small additive read-model field. No invariant conflict.**

---

## 6. Aggregates / entities & invariants (numbered)

Extending CONST-COM-020..026:

- **CONST-COM-020 (Contract).** A `CLIENT_CONTRACT` binds to the **server-resolved** single committed BOQ; the create
  DTO carries **no** `boqVersionId`. No committed BOQ ⇒ gated create (`BOQ_NOT_COMMITTED`).
- **CONST-COM-021 (Contract).** `contractValue` for a `CLIENT_CONTRACT` = committed-BOQ in-contract tie-out, never
  hand-entered; the create DTO carries **no** `contractValue` for CLIENT_CONTRACT. SUBCONTRACT keeps its supplied
  value. Reinforces ADR-029 I-1.
- **CONST-COM-022 (Contract).** `contractNumber` is minted in infrastructure from `Project.code` via an atomic
  per-project sequence (`${code}-C{n}`); the create DTO carries **no** `contractNumber`. Uniqueness backstopped by the
  existing duplicate guard + unique index.
- **CONST-COM-023 (VariationOrder ↔ ContractPaymentInstallment) — the money invariant.** A partnered VO carries a
  durable `stageInstallmentId` (**new column**) to exactly one **un-billed** installment of the **same contract**; it
  bills **exactly once** (partnered XOR standalone); the installment %-schedule stays frozen on `baseContractValue`;
  `contractValue`(current) = `base + Σ adopted VO net` (unchanged); the partnered amount is **additive and
  separately identifiable** on the invoice (requires `ClientInvoiceLine` under Option A). *Client billing rule —
  pending Eng Ahmed.*
- **CONST-COM-024 (ContractPaymentPlan).** The editor rejects any save whose editable rows do not reconcile to the
  required total; invoiced installments immutable. Already server-enforced; client must mirror.
- **CONST-COM-025 (read model).** A blocked action renders its reason + remediation at the point of action and on the
  ribbon; the MILESTONE `current-cycle` branch must lift the focus installment's blocker onto `blockers`/`nextAction`.
- **CONST-COM-026 (tabs).** MILESTONE shows exactly `Contract · Payment Schedule · Variations · Billing`; no Overview,
  no Applications. `commercialTabsFor` drops `'overview'`.

---

## 7. Legal / illegal transitions — the VO ↔ installment partnership

```
Precondition to partner:  VO.status = CLIENT_APPROVED  AND  VO.boqAppliedAt != null  (adopted)
                          AND installment.clientInvoice = null (un-billed)  AND same contract

  (unpartnered) ──assign(installmentId)──▶ (partnered → installment X)      [legal iff X un-billed]
  (partnered X) ──unassign / reassign(Y)─▶ (partnered Y | unpartnered)       [legal iff X and Y un-billed]
  (partnered X) ──installment X invoiced─▶ (partnered X, FROZEN)             [pairing now immutable]
  (partnered X) ──replacePaymentPlan drops X─▶ (unpartnered)                 [auto SetNull + audit]
  VO approved after all milestones billed  ─▶ (standalone; cannot partner)   [never stuck]
```

**Illegal (must be rejected):** partner to a billed installment (`INSTALLMENT_ALREADY_BILLED`); partner across
contracts; partner a non-CLIENT_APPROVED / non-adopted VO; bill the same VO both standalone and on an installment;
an omission that drives an installment invoice subtotal negative (`PARTNER_WOULD_MAKE_INVOICE_NEGATIVE`); mutate a
frozen pairing after its installment is invoiced.

---

## 8. Endpoints / DTOs — consolidated (new / changed)

| Change | Layer | Notes |
|---|---|---|
| `POST /contracts` `CreateContractDto` — drop `boqVersionId`/`contractValue`/`contractNumber` (CLIENT_CONTRACT) | presentation | §1 |
| Repo `findCommittedBoqVersionForProject` | infrastructure | resolves the single committed BOQ (§1.2) |
| Repo `nextContractNumber` + `ContractNumberSequence` table | infrastructure | atomic mint (§1.4) |
| `getCurrentCycle` MILESTONE branch — lift focus blocker to `blockers`/`nextAction` | application | §2.2 / §4.1 |
| `CommercialPaymentScheduleVariationLine.stageInstallmentId` — read **real** column | application | §3.1 |
| **`VariationOrder.stageInstallmentId`** relation → `ContractPaymentInstallment` (`SetNull`, indexed) | **schema** | §3.1 — additive migration |
| **New command** `POST /variations/:id/partner-installment` (+ unassign) | presentation/application | `contractsManage`, `$transaction`+audit (§3.4) |
| **`ClientInvoiceLine`** child table (Option A) + `generateFromInstallment` builds lines | **schema**/application | §3.2 — only if invoice is literally itemised |
| Construction **read port** for accounting: "partnered VO lines for installment X" | application (port) | keeps ARCH-BOUNDARY-001 (§3.4) |
| Variations list read — add per-VO `invoiced?` chip data | application | reuses `certifiedInvoicedByVariation` (§3.5) |
| `CommercialPaymentSchedule.editableTargetPercentage` (optional) | application | CD9 client gate safety (§4.2) |
| `CommercialBillingResponse.cashflowSeries` (optional) | application | CD14, or derive client-side (§5) |

---

## 9. Migration, compatibility & failure semantics; risks

**Backward compatibility.**
- **Existing contracts** keep `contractNumber`, `contractValue`, `boqVersionId` — the create changes are input-only;
  reads are unchanged.
- **Existing standalone VOs** default `stageInstallmentId = null` ⇒ remain standalone (today's behaviour). No backfill.
- **MEASURED_IPC contracts** keep the Applications surface, retention/advance, and the IPA→IPC→invoice chain — CD4/CD5
  hide, never delete. `securityPosition.applicable` already distinguishes them (`:1146`).
- **Legacy MILESTONE contracts with null `baseContractValue`** fall back to `contractValue` for the schedule
  (`:1002-1004`, M-4) — unaffected.
- New tables (`ContractNumberSequence`, `ClientInvoiceLine`) and the new nullable column are **additive** (matches the
  repo's hand-authored, additive migration convention, e.g. `20260910140000_boq_redesign_r7_separate_charge_invoice`).

**Failure semantics.** Read models already degrade gracefully (`Promise.allSettled`, `.catch(() => [])`
`:270-278,381-394,994-996`). The partner command and partnered-invoice generation are single `$transaction`s; a
P2002 on the installment invoice returns the existing invoice (`:197-204`). A dropped partner target is `SetNull` +
re-derived. No path double-bills.

**Named risks / invariant checks.**
- **R1 (§1.2).** The committed-BOQ resolver can find **two** rows in `COMMITTED_BOQ_STATUSES` during the R2
  `COMMITTED`/`BASELINED` overlap. Today the caller supplies the id, hiding the ambiguity. The resolver must tie-break
  deterministically (prefer `COMMITTED`) and should assert a single operational version — **surface to Abdulsalam**;
  it is not blocking but is a correctness edge.
- **R2 (§3.1).** The redesign docs assert "no schema change; the `stageInstallmentId` seam exists." **False** — it is a
  read-type placeholder only. Partnering **requires** an additive `VariationOrder.stageInstallmentId` column. The ADR-030
  and design-doc "No schema change expected" lines must be **corrected**.
- **R3 (§3.2) — invariant tension.** CD10's "itemised sub-line" cannot be represented by the header-only `ClientInvoice`.
  Folding the VO into the installment subtotal (Option B) **violates ADR-029 CONST-BOQ-032 / ADR-026 CONST-VAR-008**
  ("each variation separately identifiable … never merged into the milestone amount"). Only Option A (add
  `ClientInvoiceLine`) or Option C (separate co-presented invoice) preserve identifiability. Choosing Option B without
  Eng Ahmed explicitly retiring CONST-BOQ-032 would be **UNSAFE**.
- **R4 (§3.3 #5 / CD12).** A negative (omission) partner can drive an installment invoice subtotal negative; needs a
  guard and Eng Ahmed's ruling on negative milestone lines vs credit notes.

---

## 10. What is ADR-worthy

ADR-030 already records CD1–CD16 / CONST-COM-020..026. Two things it does **not** yet capture and should, as an
**amendment to ADR-030** once Eng Ahmed answers CD10:

1. **The `stageInstallmentId` is a new durable relation, not an existing seam** (correct the "no schema change" claim).
2. **The partnered-invoice representation decision** (Option A `ClientInvoiceLine` vs Option C separate co-presented
   invoice) — this is the load-bearing money model choice and supersedes/qualifies CONST-BOQ-032's "never merged."

---

## Verdict

**DECISIONS REQUIRED.**

Clusters **1, 2, 4, 5 are APPROVED** as architecture: they extend existing patterns with presentation changes plus
thin, additive server work (contract-number sequence; ribbon blocker lift; optional read-model fields). No invariant
is violated by those clusters.

Cluster **3 (CD10/CD11/CD12 — the money-critical partnering) is blocked on named decisions and carries an invariant
risk:**

1. **CD10 — Eng Ahmed (client billing rule).** Confirm partnering a variation onto a milestone invoice is acceptable
   to clients/consultants, and choose the representation: **CD10a** = one *itemised* invoice (Option A, new
   `ClientInvoiceLine`) **or** a *separate co-presented* variation invoice (Option C). This supersedes/qualifies
   ADR-029 CONST-BOQ-032.
2. **CD10b / CD12 — Eng Ahmed.** For an omission, is a **negative milestone line** acceptable, or must it be a credit
   note? (Drives the R4 negative-subtotal guard.)
3. **R2 — correct ADR-030 and the design doc:** `stageInstallmentId` is a **new** durable
   `VariationOrder → ContractPaymentInstallment` relation, not an existing seam. Partnering **requires** an additive
   schema migration (and, under Option A, a `ClientInvoiceLine` table). This is a backend change owned by Abdulsalam.
4. **R1 — Abdulsalam (non-blocking):** define the committed-BOQ tie-break when `COMMITTED` and legacy `BASELINED`
   coexist.

If CD10 is resolved as **Option B** (fold the VO into the installment subtotal, no separate line), the result is
**UNSAFE** — it breaks the standing "each variation separately identifiable / never merged into the milestone amount"
invariant (ADR-026 CONST-VAR-008, ADR-029 CONST-BOQ-032) and must not be built without Eng Ahmed explicitly retiring
that invariant.
