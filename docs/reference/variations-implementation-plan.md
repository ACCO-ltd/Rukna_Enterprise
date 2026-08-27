# Variations / Change Orders — phased implementation plan

**ADR:** ADR-026 (proposed) · **Issue:** #51 · **Status:** plan for review · **Owner:** Abdulsalam

Turn ADR-026 into a **phased, each-phase-shippable** backend→frontend sequence. Each phase is
independently reviewable and leaves the system in a coherent state; nothing later depends on a
half-built earlier phase. Sequencing is on **certainty**: the aggregate + contract-value truth first
(the part the memo froze hardest and the rest builds on), the harder scope-into-chain and the
at-risk exceptions later, the UI last.

**Do not start Phase 1 until the four open sub-questions in ADR-026 (OQ-1..OQ-4) are answered by
Eng Ahmed.** OQ-1 (7B cap) blocks only Phase 5; OQ-2/OQ-4 shape Phases 2 and 3; confirm them before
those phases, not necessarily before Phase 1.

Reused machinery (built, do not rebuild): BOQ revision + `BoqNode.sourceType`/`sourceChangeOrderId`
provenance (ADR-016, already in schema), the IPA→IPC→ClientInvoice chain **unchanged** (ADR-005/017/024),
`CommandGovernanceService` + value-band engine (ADR-022 Phases 2/3), the ADR-019 guarded-command +
condition-override pattern, and the commercial summary read model (ADR-017 Gate B).

---

## Phase 0 — Resolve open sub-questions (no code)

- **Goal:** get OQ-1..OQ-4 answered so no phase guesses a domain fact.
- **Deliverable:** a follow-up CEO memo in `docs/backend-requests/`; update ADR-026 with the answers
  (or a linked amendment note).
- **Depends on:** nothing.
- **De-risks:** every later phase — prevents building on an assumed cap, repoint rule, or approval
  evidence.
- **ADR rules:** OQ-1 (CONST-VAR-011), OQ-2 (CONST-VAR-007), OQ-3 (CONST-VAR-001), OQ-4 (CONST-VAR-004).

---

## Phase 1 — VariationOrder aggregate + lifecycle + Pending/Approved contract value

- **Goal:** a first-class `VariationOrder` you can create, line-item (additions **and** signed-negative
  omissions), submit, internally approve (DOA), and client-approve — and a **truthful contract value**
  that reports Original / Approved / Governing / Pending without touching a single downstream table.
- **Aggregate:** new `VariationOrder` module (`business/construction/variations/`, Clean Architecture
  layers) — root + line items + per-contract sequential reference; the DRAFT→PENDING_INTERNAL→
  INTERNAL_APPROVED→CLIENT_APPROVED (+REJECTED/WITHDRAWN) state machine as guarded commands.
- **Endpoints (indicative):** `POST /contracts/:id/variations` (draft), line-item CRUD while DRAFT,
  `POST /variations/:id/submit`, `.../withdraw`, `.../reject`, and the two approval transitions
  (internal via governance gate; client-approval with OQ-4 evidence).
- **Contract value:** derive `governingContractValue = original + Σ CLIENT_APPROVED net` and the
  `pendingVariations = Σ (PENDING_INTERNAL + INTERNAL_APPROVED) net`. **Do not mutate**
  `Contract.contractValue`. Extend the ADR-017 commercial summary read model with the four figures.
- **Governance:** wire `VariationOrder` internal approval through `CommandGovernanceService.gateStateTransition`
  with amount-banded bindings on `|net price|` (reuse `acco-value-bands.ts` shape). Bands seeded
  **inactive**, like every other ADR-022 chain.
- **Depends on:** Phase 0 (OQ-4 for the client-approval command shape). Reuses ADR-022 governance.
- **De-risks:** the core of the memo — the pending-vs-approved rule and immutable-baseline preservation.
  Once this is right, everything downstream is additive.
- **ADR rules:** CONST-VAR-001, -002, -003, -004, -005, -006, -006a, -010, -012.
- **Ships as:** a usable "raise and approve a variation; see contract value change only on client
  approval" capability, even before the scope flows into the BOQ.

---

## Phase 2 — Scope a client-approved VO into the project (variation-tagged BOQ revision)

- **Goal:** when a VO reaches CLIENT_APPROVED, its scope enters the BOQ as `sourceType = VARIATION`
  nodes on a new baseline revision, tying `BoqNode.sourceChangeOrderId` to the VO.
- **Aggregate:** BOQ (reused) — the existing Revision (deep-copy) + governed baseline approval
  (ADR-016 CONST-BOQ-018, ADR-022 CONST-DOA-009). Variation module orchestrates: on CLIENT_APPROVED,
  open/append a revision carrying the VO's nodes with provenance set; omissions negate/zero affected
  nodes.
- **Endpoints:** extend the BOQ revision flow to accept variation-sourced nodes; make
  `BoqNode.sourceChangeOrderId` a real FK to `VariationOrder`; resolve the OQ-2 Contract-Baseline
  repoint (explicit audited act, engineering lean).
- **Depends on:** Phase 1; Phase 0 OQ-2. Reuses BOQ revision + governance.
- **De-risks:** the "approved variation becomes priced work" half of Q4, on the **existing** revision
  path — no parallel scope ledger (ADR-026 Option A vs B/C/D).
- **ADR rules:** CONST-VAR-007; preserves ADR-016 CONST-BOQ-023/024 immutability.
- **Ships as:** approved variation scope is visible and priced in the BOQ, tagged to its VO; the
  `VARIATION_REQUIRED` readiness blocker (ADR-016) can be switched on.

---

## Phase 3 — Certification & invoice traceability (mostly read models; the chain is unchanged)

- **Goal:** every IPA/IPC/invoice line that claims variation scope is **identifiable to its VO** —
  and, per ADR-026 CONST-VAR-008, this needs **no new column** on the chain: it rides the existing
  `IpaItem.boqNodeId → BoqNode.sourceChangeOrderId → VariationOrder` join.
- **Aggregate:** IPA/IPC/AR (reused, **not modified**). Work is in read models and presentation:
  resolve and surface the VO tag per certified/invoiced line; group/report certified & invoiced value
  by VO.
- **Endpoints:** read-model/query additions (e.g. "certified & invoiced by variation"); no write-path
  change to IPA, IPC, or ClientInvoice.
- **Depends on:** Phase 2 (nodes must carry provenance first).
- **De-risks:** proves "separately identifiable throughout" end to end (Progress→IPA→IPC→Invoice)
  with the minimal-surface Option A, confirming no `variationOrderId` needs threading downstream.
- **ADR rules:** CONST-VAR-008; preserves ADR-024 settlement truth (CONST-VAR-012).
- **Ships as:** certificate/invoice views and reports that trace each line to its variation.

---

## Phase 4 — Time-impact / Extension-of-Time command

- **Goal:** revise the contract's `expectedEndDate` **only** by an explicit, audited command that may
  cite one or more VOs — never automatically on VO approval.
- **Aggregate:** Contract (reused) — a distinct *Extension of Time* guarded command with its own
  actor/reason/evidence and audit; VO's proposed time impact is justification, not effect.
- **Endpoints:** `POST /contracts/:id/extension-of-time` (or equivalent) recording the new date +
  reason + referenced VOs.
- **Depends on:** Phase 1 (VOs exist to reference). Independent of Phases 2–3.
- **De-risks:** the memo Q5 trap — decouples date change from VO approval, mirroring ADR-023's
  entitlement-vs-issue split.
- **ADR rules:** CONST-VAR-009.
- **Ships as:** a controlled way to move the completion date, always by human decision.

---

## Phase 5 — The two at-risk commencement routes

- **Goal:** sanction (only through governed, audited records) the two exceptions — 7A project-before-
  contract, 7B urgent-variation-before-VO — with no informal-verbal path.
- **Aggregate:** 7A = Project (reused) — a **controlled waiver** of the MANDATORY `ACTIVE_MAIN_CONTRACT`
  / `CONTRACT_START_DATE` Start conditions via the existing ADR-019 condition override
  (`override: { condition, reason, approvedBy }` → `PROJECT_CONDITION_WAIVED` audit), authorised by the
  Start chain apex. 7B = VariationOrder — an `AT_RISK_COMMENCEMENT` authorisation record + named fixed
  chain (`acco-lifecycle-chains.ts` style): `[CONSTRUCTION_DIRECTOR, CFO]`, adding `CEO` above the
  OQ-1 exposure cap. At-risk commencement changes **neither** contract value **nor** BOQ.
- **Endpoints:** 7A reuses the existing `POST /projects/:id/start` override path (may need to permit
  waiving those specific MANDATORY conditions under apex authority). 7B: `POST /variations/:id/at-risk-commencement`.
- **Depends on:** Phase 1 (7B needs the VO); Phase 0 OQ-1 (the cap). 7A depends only on ADR-019
  (already built).
- **De-risks:** the memo Q7 routes, as **audited exceptions** on existing gates — never new bypasses.
- **ADR rules:** CONST-VAR-011; preserves CONST-VAR-005 (value still waits for CLIENT_APPROVED).
- **Ships as:** a controlled, fully-audited way to start work early — with no way to do it informally.

---

## Phase 6 — Commercial "Variations" UI

- **Goal:** the Commercial workspace surfaces variations end to end: raise/edit/submit/approve a VO,
  see Original / Approved / Governing / Pending on the summary, trace certified & invoiced value by
  VO, invoke Extension-of-Time, and record an at-risk authorisation — all rendering **backend** numbers
  and capabilities, never re-implementing the rules (ADR-017 constraint).
- **UI touched:** a Commercial "Variations" tab/section; the Overview/summary gains the four value
  figures + Pending badge; certification/invoice views gain the VO trace column.
- **Depends on:** Phases 1–5 (each surfaces its capability as it lands; the UI can grow tab-by-tab in
  step with the backend phases rather than waiting for all of them).
- **De-risks:** puts the whole model in front of ACCO for real-world validation; consumes derived
  capabilities (Gate B/C pattern), so no business rule leaks into the client.
- **ADR rules:** all of ADR-026, as consumed through backend read models/capabilities.
- **Ships as:** the operable Variations feature (issue #51 delivered).

---

## Sequencing summary

| Phase | One line | Blocks on |
|---|---|---|
| 0 | Answer OQ-1..OQ-4 (follow-up memo) | — |
| 1 | VariationOrder aggregate + lifecycle + Pending/Approved contract value (derived) | OQ-4 |
| 2 | Scope client-approved VO into the BOQ as variation-tagged revision nodes | 1, OQ-2 |
| 3 | Certification/invoice traceability via `boqNodeId` (read models; chain unchanged) | 2 |
| 4 | Explicit Extension-of-Time command (date never moves automatically) | 1 |
| 5 | The two at-risk routes (7A Start waiver, 7B VO at-risk chain) | 1, OQ-1 |
| 6 | Commercial "Variations" UI | 1–5 |

**Certainty ordering rationale:** Phase 1 encodes the memo's hardest-frozen rule (pending vs approved,
immutable baseline) and is the foundation every other phase reads from; Phase 2 is the next-riskiest
(scope-into-chain) but lands on the **existing** revision path so it stays additive; Phase 3 proves the
minimal-surface identifiability claim and is almost entirely read-model; Phases 4–5 are independent
controlled additions; Phase 6 is the consumer of all of it and can track the backend phase-by-phase.
