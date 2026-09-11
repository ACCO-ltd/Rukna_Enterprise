# Commercial & Contract — Billing-Model Refinement

**Status:** DRAFT for review — no code written yet.
**Date:** 2026-09-08
**Author:** senior product/eng review (Claude) with Abdulsalam
**Scope:** the project **Commercial** workspace and the **Contract** aggregate — make the surface fully billing-model-aware, finish milestone (installment) billing so it is editable and has a home, clean retention out of ACCO's path, and fold the legacy standalone `/contracts` UI into the workspace.

---

## 1. Why this exists

The request: *"the Commercial tab should change automatically according to the contract's billing model — if it's IPC we see IPA/IPC, milestone is different — and ACCO uses a milestone model (Advance 40% Structure / 30% Partition & Plastering / 20% Installation & Paint / 10% Inspection & Handover) with **no retention**. Clean up and improve the flow for both UI and backend."*

**Key finding from the codebase review:** most of this is *already built* but is (a) unfinished on the milestone side (create-only, no editor, no dedicated tab), (b) split across an older standalone `/contracts` UI in a different design language, and (c) carrying dead/placeholder concepts (`ContractMilestone` checklist, `TIME_AND_MATERIAL`/`HYBRID` enum values). This is a **finish + consolidate + clean-up** effort, not a green-field build.

## 2. Confirmed decisions

| # | Decision | Consequence |
|---|---|---|
| D1 | **ACCO's advance IS the first installment.** The 40/30/20/10 stage payments are the *entire* schedule and sum to 100%. The 40% "Structure" is paid early as the advance — modeled as an `ADVANCE`-trigger `ContractPaymentInstallment`. **No separate advance principal, no recovery deductions.** | Matches ADR-023 (`schema.prisma:1403` "ACCO V1: no retention, no advance recovery"). **No billing-math changes needed.** |
| D2 | **Fold the standalone `/contracts` UI into the project Commercial workspace** and retire the old design-language pages. | Contract create/edit + IPA/IPC authoring move into the workspace idiom; old `/contracts/*` pages redirect. |
| D3 | **ACCO does not use retention.** | Retention surfaces stay behind "contract has retention terms"; the create flow defaults to none. (Mostly already true — see §4.) |
| D4 | Spec first; implementation reviewed before any code. | This document. |

## 3. Current state (grounded)

### 3.1 What already works — do NOT rebuild
- **`billingModel` enum** `MEASURED_IPC | MILESTONE | TIME_AND_MATERIAL | HYBRID` — `schema.prisma:3192`.
- **The Commercial tab already reshapes on billing model.** `commercialTabsFor()` (`commercial-nav.tsx:38-45`) hides **Applications & Certification** when `billingModel === 'MILESTONE'`; a force-navigation to the hidden route renders a real explanatory empty state, not a crash.
- **A real milestone billing engine exists:** `ContractPaymentInstallment` (`schema.prisma:1404-1425`) → `ClientInvoice.generateFromInstallment()` (`client-invoice.service.ts:129-193`), invoiced at `contractValue × percentage`, one invoice per installment, plan validated to sum to 100% at creation (`contract.service.ts:202-227`).
- **Retention is cleanly isolated & optional:** a single `if (contract?.retentionTerms)` guard (`ipc.service.ts:152`); milestone contracts show *"…deducts no retention"* (`contract-security-tab.tsx:423`). Absence of retention is the default path, not a special case.
- **The ACCO schedule is already expressible** with the existing installment fields (`sortOrder, name, percentage, triggerType, dueOffsetDays?, dueDate?, milestoneLabel?, programmeMilestoneId?`).

### 3.2 What is broken / missing / debt
| ID | Problem | Evidence |
|---|---|---|
| G1 | **Two "milestone" concepts.** `ContractMilestone` (`schema.prisma:1452`) is a *descriptive checklist* with no %, no amount, no billing wiring. The billing entity is `ContractPaymentInstallment`. Confusing and error-prone. | `contract.service.ts:594-655` (checklist only); grep shows no AR/invoice code touches `ContractMilestone`. |
| G2 | **The payment plan is create-only — no editor.** Set only inline in `ContractForm`; no PATCH route, no post-creation UI. | `contract-form.tsx:151` ("there is no PATCH for the plan"). |
| G3 | **Milestone billing has no home** — split across Overview "Payment plan" panel, Overview "Current Payment Cycle" card, and Billing & Collection "Payment schedule" panel. No dedicated tab. | `payment-plan-panel.tsx`, `current-payment-cycle.tsx`, `payment-schedule-panel.tsx`. |
| G4 | **Standalone `/contracts` is a second, older UI** (old `Tabs`, Phosphor icons, hardcoded shadow tokens) that duplicates Contract & Security and **hosts all the write flows**; the workspace deep-links *out* into it mid-task. Orphaned from the sidebar yet load-bearing. | `contract-detail.tsx:151-159`; `applications-tab.tsx:70,188`; `app-shell.test.tsx:118` ("Contracts is no longer a standalone sidebar destination"). |
| G5 | **Dead code / dead enums.** `project-contracts-section.tsx` is never rendered; `TIME_AND_MATERIAL` and `HYBRID` are placeholders nothing consumes. | grep: `project-contracts-section.tsx` unreferenced. |
| G6 | **Money soft-spots** (lower priority given ACCO-milestone): advance recovery on the IPC path has no principal cap; IPA/IPC deduction amounts are authored client-side with no server validation; VAT is hardcoded 5%. | `ipc.service.ts:160-170`; `ipa-deductions-panel.tsx:253`; `client-invoice.service.ts:89`. |
| G7 | **Contract is always project-scoped** (`projectId` NOT nullable, `schema.prisma:1330`). The `/contracts` list is an org-wide index, **not** project-less contracts. | — |

## 4. Target model

### 4.1 Commercial tabs by billing model
| Billing model | Tabs |
|---|---|
| **MEASURED_IPC** | Overview · Contract & Security · **Applications & Certification** · Variations · Billing & Collection *(unchanged)* |
| **MILESTONE** *(ACCO default)* | Overview · Contract & Security · **Payment Schedule** *(new, first-class, editable)* · Variations · Billing & Collection |
| **HYBRID** *(deferred — ACCO mixed jobs)* | both **Applications** *and* **Payment Schedule** |
| **TIME_AND_MATERIAL** | retire the value, or park behind a flag with an explicit "not supported" state |

### 4.2 ACCO's schedule as data (the canonical example)
A MILESTONE contract for ACCO = four `ContractPaymentInstallment` rows summing to 100%:

| sortOrder | name | percentage | triggerType | invoice gate |
|---|---|---|---|---|
| 0 | Structure | 0.40 | `ADVANCE` | none — billable once contract is ACTIVE (advance paid early) |
| 1 | Partition & Plastering | 0.30 | `MILESTONE` | optional linked programme milestone must be `VERIFIED` |
| 2 | Installation & Paint | 0.20 | `MILESTONE` | " |
| 3 | Inspection & Handover | 0.10 | `MILESTONE` | " |

**Trigger semantics to make explicit (currently implicit):**
- `ADVANCE` → invoiceable as soon as the contract is ACTIVE; **no** progress/verification gate. (This is why the 40% "advance" is not a deduction — it's simply the first stage invoice.)
- `MILESTONE` → gated on a linked `ProgrammeMilestone` being `VERIFIED` when one is linked; billable on its label if unlinked (existing behavior — keep, but surface the "ungated" state clearly).
- `TIME_BASED` → gated on due date.

This becomes a saved **"ACCO standard schedule" template** so a user creating a milestone contract can one-click prefill 40/30/20/10 and rename stages.

### 4.3 One milestone concept
Retire the descriptive `ContractMilestone` checklist (G1). ACCO's milestones *are* payment stages, and `ContractPaymentInstallment` already carries name, order, and a verification link. **Recommendation:** remove `ContractMilestone` + its `addMilestone`/`completeMilestone` routes + the "Contractual milestones" table, migrating any real data to installments. *(Decision point — see §7 Q-A: confirm nothing operational depends on the checklist before deleting.)*

## 5. Phased plan

Each phase is independently shippable, backend + frontend + tests, smallest-safe-slice first. Run `pnpm --filter @erp/web type-check` before every web push.

### Phase 0 — Naming & dead-code cleanup *(low risk, unblocks clarity)*
- Retire `ContractMilestone` (pending §7 Q-A) or, if kept, rename to `ContractDeliverable` to end the collision.
- Delete `project-contracts-section.tsx` (dead).
- Decide `TIME_AND_MATERIAL`: remove from the enum or add an explicit "unsupported" guard so it stops silently rendering the measured UI.
- Tests: schema migration test; contract read-model unaffected.

### Phase 1 — Editable payment schedule (backend)
- New routes on the contract controller to manage installments post-creation:
  - `POST /contracts/:id/installments`, `PATCH /contracts/:id/installments/:installmentId`, `DELETE /contracts/:id/installments/:installmentId`, `POST /contracts/:id/installments:reorder`.
  - Every mutation re-runs `assertPaymentPlanReconciles` (must sum to 100%).
- **Editability rule (design decision, §7 Q-B):** freely editable while contract is `DRAFT`; once `ACTIVE`, only **un-invoiced** installments may be edited/removed and total must still reconcile — changes are audited; an installment with a posted `ClientInvoice` is frozen.
- Trigger semantics from §4.2 made explicit in `generateFromInstallment` (ADVANCE ungated; MILESTONE gated on verified link; TIME_BASED on due date).
- Governance: installment edits on an ACTIVE contract routed through the same audit/authorization path as other contract mutations.
- Tests: reconcile-to-100 enforcement, frozen-installment guard, ADVANCE-ungated invoice, MILESTONE-gated invoice.

### Phase 2 — First-class "Payment Schedule" tab (frontend)
- Add a `payment-schedule` tab to the Commercial workspace, shown for MILESTONE (and HYBRID later); consolidate the three scattered surfaces (G3) into it — installment ledger, generate-invoice, link-milestone, reconciliation-to-100 footer.
- Inline editor (add/edit/reorder/remove) wired to Phase 1, with the DRAFT-vs-ACTIVE affordances.
- **"ACCO standard schedule" template** quick-fill (40/30/20/10; Structure = ADVANCE).
- Keep the Overview panel as a *summary* that links into the tab; remove the duplicate schedule from Billing & Collection (or make it a read-only mirror).
- Design-system: `@erp/ui` (`SectionCard`, `Table*`, `ViewSwitcher`), lucide icons, `next-intl`, 375px + dark verified.

### Phase 3 — Fold standalone `/contracts` into the workspace (D2)
- Move contract **create** and **edit** into the workspace design language (invoked from Contract & Security), and move **IPA/IPC authoring** (`applications/new`, `applications/[ipaId]`, `certificates/*`) under the project workspace so actions no longer deep-link out into the old UI.
- Redirect legacy `/contracts/*` routes (mirror the existing `main-contract`/`retention-advances` → `contract-security` redirect pattern) to their workspace equivalents; keep a thin org-wide contracts **index** only if still wanted (else redirect to Projects).
- Delete the old-design `contract-detail.tsx` tabs once nothing references them.
- Tests: update `app-shell.test.tsx`; add redirect coverage; QA the IPA→IPC authoring inside the workspace frame.

### Phase 4 — Retention cleanup for ACCO (D3) *(small)*
- Ensure the contract create flow defaults to **no retention terms** and does not surface retention fields unless the user opts in.
- Confirm every retention surface is gated on `retentionTerms` presence (mostly done); keep the "not applicable" messaging for milestone contracts.
- Tests: milestone contract renders no retention anywhere; measured-without-retention renders clean.

### Phase 5 — Deferred / optional (money hardening + HYBRID)
- Advance-recovery principal cap + server-derived IPA/IPC deduction amounts + VAT to tax config (G6). *(Moot for ACCO-milestone; do when a MEASURED_IPC-with-advance/retention contract is real.)*
- First-class **HYBRID** support for ACCO's mixed lump-sum + remeasurable jobs (memory: "D7 = mixed"): a contract that shows **both** the Payment Schedule (lump-sum portion) and Applications (remeasurable portion).

## 6. Non-goals
- No change to the IPA/IPC certification math or the GL posting path.
- No change to Variations, Progress, or Finance workspaces (beyond links).
- HYBRID and MEASURED_IPC advance/retention hardening are explicitly deferred (Phase 5).

## 7. Decisions (resolved 2026-09-08)
- **Q-A (Phase 0) — `ContractMilestone` checklist:** ✅ **delete it** (vestigial; installments + programme milestones cover the real needs). ▶ **Pending a one-query check** that no live ACCO contract populated the "Contractual milestones" table — if any did, rename to `ContractDeliverable` instead.
- **Q-B (Phase 1) — ACTIVE-contract plan edits:** ✅ **DRAFT = freely editable; ACTIVE = re-profile *un-invoiced* stages (name/date/reorder, and re-split % that still sum to the same remaining balance) with an audit trail; changing the contract *value* or an *already-invoiced* stage requires a Variation.** Money-affecting changes go through variations; scheduling mechanics don't. *(Confirm with Eng Ahmed.)*
- **Q-C (Phase 3) — standalone `/contracts`:** ✅ **keep a reskinned, read-only org-wide contracts index** (portfolio view) but **move all authoring into the project workspace**; retire/redirect the old-design detail/edit/IPA-IPC pages.
- **Q-D — VAT:** ✅ **defer — leave 5% hardcoded now**, logged as tech-debt to lift into config in Phase 5.

## 8. Risk & sequencing notes
- Phases 0→1→2 deliver the core value (editable milestone billing with a home) and are low-risk. Phase 3 (fold-in) is the largest surface change and should land after 0–2 so the workspace target already exists.
- `ContractMilestone` removal is a Prisma migration — sequence a data check first (Q-A).
- Shared-working-tree hazard (per project memory): stage explicit paths, never `git add -A`.
