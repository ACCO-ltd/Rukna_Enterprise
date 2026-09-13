# Commercial workspace redesign — build tickets

From `commercial-workspace-redesign-spec.md` (ADR-030, accepted). Eight slices, each a narrow but
complete vertical, demoable on its own, sized for one context window. The clean-up/subtract is **slices
C1–C2** (so "clean" precedes "upgrade", per owner sequence). Phase-2 credit notes and Phase-3
one-document invoices are **not** ticketed here (spec §8). Owners: backend = Abdulsalam; frontend = FE
engineer (Abdulsalam has been building `apps/web` directly this effort).

---

### C1 — Contract-create: bind committed BOQ, auto value + number (backend)
- **Objective:** the create flow needs only client + dates; value = tie-out, number = auto, BOQ = the one committed version.
- **Scope:** drop `boqVersionId`/`contractValue`/`contractNumber` from the required DTO; resolve the project's committed BOQ server-side; keep `deriveTieOutValue`; add an atomic per-project **contract-number sequence** in infrastructure (ADR-025 pattern); gate create when no committed BOQ (`BOQ_NOT_COMMITTED`).
- **Dependencies:** none. **Write area:** `contracts/` (service, repo, DTO, controller). Disjoint.
- **Acceptance (S-CC-1..4):** POST `{clientId,startDate,expectedEndDate}` → contract with `base==current==tie-out`; concurrent creates → unique `…-C1/-C2`; DRAFT-only BOQ → refused, no row; `billingModel` defaults MILESTONE.
- **Tests:** unit (DTO/derive) + DB-backed (sequence uniqueness, tie-out, gate).
- **Non-goals:** the form UI (C2). **Risks:** number-sequence collisions under concurrency — cover with a DB-backed concurrent test.
- **Classify:** PARALLEL.

### C2 — 4-tab shell, Overview retirement, "Contract" rename, minimal form (frontend)
- **Objective:** the workspace becomes 4 tabs with a near-empty create form.
- **Scope:** `commercialTabsFor` → `Contract · Payment Schedule · Variations · Billing` for MILESTONE; delete the **Overview** tab + route (redirect `/commercial` → landing); rename "Contract & Security" → "Contract"; render retention/advance panels only when configured; keep guarantees; the create form shows client+dates only, value read-only (live tie-out), number auto.
- **Dependencies:** C1 (form contract). **Write area:** `features/commercial/*`, `app/(app)/projects/[id]/commercial/*`. 
- **Acceptance (S-CC-5, S-SH-1/4/5):** 4 tabs render; old Overview route redirects; `/applications` on MILESTONE shows the not-applicable state; no editable value/number/version inputs; no retention panel without terms.
- **Tests:** component (nav set per billing model, form fields, redirect).
- **Non-goals:** the ribbon (C3). **Risks:** dead-code removal breaking imports — do it as an explicit clean-up (audit first, like the BOQ vocab pass).
- **Classify:** SEQUENTIAL (after C1).

### C3 — Persistent cycle ribbon (backend blocker + frontend)
- **Objective:** `stage · blocker · one action` on every tab.
- **Scope:** **backend** — `getCurrentCycle` emits the milestone-verification blocker on the MILESTONE branch (today `blockers:[]`, `commercial.service.ts:743`). **frontend** — a persistent ribbon component consuming `getCurrentCycle`, mounted on all 4 tabs.
- **Dependencies:** C2 (shell placement). Backend blocker is independently landable. **Write area:** `commercial.service.ts` (read model) + `features/commercial/*`.
- **Acceptance (S-SH-2/3):** ribbon shows identical stage/action on all tabs; a NEXT installment on an un-verified milestone returns a blocker with a remediation URL and the ribbon renders it.
- **Tests:** unit (blocker in read model) + component (ribbon on each tab, disabled-with-reason action).
- **Non-goals:** the payment-schedule row blocker (C7 reuses this). **Risks:** none material.
- **Classify:** SEQUENTIAL (after C2); the backend blocker slice is PARALLEL.

### C4 — Variation billing P1: entitlement/realization split + allocation ledger (backend, migration)
- **Objective:** the persistence + invariant backbone for variation billing.
- **Scope:** add `VariationOrder.billingTreatment (WITH_STAGE|STANDALONE, default WITH_STAGE)`; new **`VariationBillingAllocation`** table (`INVOICE|STAGE_REDUCTION` used, `CREDIT_NOTE` declared-unused); the **exactly-once** invariant (`Σ==netValue`); confirm approving a VO still moves `contractValue` with `baseContractValue` + %-schedule frozen; the **additive migration** + backfill so existing VOs satisfy the invariant.
- **Dependencies:** none structurally. **Write area:** `variations/`, `prisma/schema.prisma` + migration.
- **Acceptance (S-VB-1..4, S-MG-1):** approve VO-001(+2,000) → `contractValue`+2,000, base + percentages unchanged, no allocation yet; a second INVOICE allocation exceeding `netValue` is rejected; migrate on a prod-data clone → every VO `Σ==net` or unrealized.
- **Tests:** DB-backed (invariant, backfill, entitlement-unchanged) + migration dry-run on a clone.
- **Non-goals:** invoice generation (C5). **Risks:** backfill correctness for any pre-existing standalone-billed VOs — verify on the clone.
- **Classify:** PARALLEL (backend, disjoint from shell work).

### C5 — Variation billing P1: bill-this-stage flow + Billing Package + omissions (backend)
- **Objective:** generate the milestone + included-VO invoices as an independently-payable, grouped package.
- **Scope:** a "bill this stage" command taking include/defer choices → `generateFromInstallment` (milestone) + `generateFromSeparateCharge` per included VO (tagged `sourceVariationId` + `installmentId`) + `INVOICE` allocations; the **Billing Package read model** (group by `installmentId,billingCycle`); omission on an un-invoiced stage → reduced milestone subtotal + `STAGE_REDUCTION` allocation; refuse netting into an already-invoiced stage (P2 message); "Sales Tax" surface label.
- **Dependencies:** C4. **Write area:** `variations/` + `commercial/`/`accounting` invoice services (via a construction read-port; Accounting must not import Variations).
- **Acceptance (S-VB-5..10):** bill M2 with VO-001 included → two invoices + allocation; excluded → one invoice, VO still billable; package total == sum; M3 with omission bills net + records −amount; already-invoiced net → refused.
- **Tests:** DB-backed (two-invoice generation, defer path, package grouping, omission reduction, already-invoiced refusal, allocation exactly-once).
- **Non-goals:** credit notes (P2). **Risks:** module boundary (invoice-gen in Accounting) — use a read-port, keep the dependency one-way.
- **Classify:** SEQUENTIAL (after C4).

### C6 — Variation billing P1: frontend (bill-this-stage, variations list, package view)
- **Objective:** the QuickBooks-clean money-raise UX.
- **Scope:** the "Bill this stage" dialog (stage amount + eligible VOs with include/defer + live billing-now/deferred summary); the Variations list showing `billingTreatment`, allocation status, and an inline **"Invoiced?"** chip (from the certified/invoiced-by-variation read model); the Billing-Package presentation ("Milestone N Billing" with base + VO lines + presented total).
- **Dependencies:** C5 (+ C2 shell). **Write area:** `features/commercial/*`.
- **Acceptance (S-VB-11/12):** toggling a VO updates totals; Generate creates the package; a billed VO shows "✓ invoiced (INV-xxx)", a deferred one "approved · not billed".
- **Tests:** component (dialog include/defer math, chip states, package render).
- **Non-goals:** none. **Risks:** none material.
- **Classify:** SEQUENTIAL (after C5).

### C7 — Payment-schedule polish (frontend + reuse C3 blocker)
- **Objective:** no dead buttons; an honest editor.
- **Scope:** render the gate reason + remediation link **on the installment row** (reuses C3's blocker), disable Generate with the adjacent why; the plan editor blocks Save at ≠required-total (mirror `assertPaymentPlanReconciles`) with a live delta; invoiced rows visibly locked under a "N% already billed" header.
- **Dependencies:** C3 (blocker read model), C2 (schedule tab). **Write area:** `features/commercial/payment-schedule*`.
- **Acceptance (S-PS-1..3):** blocked NEXT row shows reason+link, no bare disabled button; a 95% plan can't be submitted; invoiced rows non-editable + labeled.
- **Tests:** component (row blocker, disabled Save at ≠100%, locked rows).
- **Classify:** SEQUENTIAL (after C2/C3).

### C8 — Billing money story + cashflow chart
- **Objective:** one coherent, professional money surface.
- **Scope:** the money story on Billing (`Contract value → Invoiced → Collected → Outstanding`, with approved-but-unbilled variations shown distinctly); a **collected-vs-invoiced cashflow curve** (read-model time series from existing invoice/receipt dates); aging (current/30/60/90).
- **Dependencies:** C2 (billing tab). **Write area:** `commercial.service.ts` (getBilling time series) + `features/commercial/billing*`.
- **Acceptance (S-BL-1..3):** deferred VO reads "approved · billed $0", not missing revenue; the curve matches the ledger cumulatively; aging buckets sum to outstanding.
- **Tests:** unit (time series) + component (chart, money story, aging).
- **Classify:** SEQUENTIAL (after C2).

---

## Dependency graph

```
C1 (contract-create BE) ──► C2 (4-tab shell + form FE) ──┬──► C3 (ribbon)  ──► C7 (schedule polish)
                                                         ├──► C8 (billing story + chart)
                                                         └──► C6 (variation billing FE)
C4 (allocation ledger BE + migration) ──► C5 (bill-this-stage + package BE) ──► C6
```

**Two independent tracks:** the *shell/clean-up/polish* track (C1→C2→{C3,C7,C8}) and the *variation-billing P1*
track (C4→C5→C6). They converge only at C6. Neither waits on Eng Ahmed (his call is banked); the accountant's
sales-tax/credit-note confirmation is only needed before **Phase 2** (not in these tickets).

**Suggested order:** C1 → C2 → C3 → (C4 in parallel) → C7 → C8 → C5 → C6. The clean-up lands first (C1–C2),
the workspace feels professional early (C3/C7/C8), and the money-raise (C4→C6) lands as the finale.
