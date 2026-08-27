---
Status: proposed
---

<!-- Scoping deliverable for issue #51. Domain requirements frozen by Eng Ahmed Shirie (CEO, ACCO
Ltd) 2026-08-27 — see docs/backend-requests/ceo-memo-variations-change-orders.md, the
"DECISION — Eng Ahmed (memorandum, 2026-08-27)" section. This ADR is design-only: no schema, no
endpoints, no code. It records the target model so the phased build (see
docs/reference/variations-implementation-plan.md) stays coherent. Open sub-questions the memo did
not resolve are listed at the end and go back to Eng Ahmed in a follow-up memo before the aggregate
is built. -->

# Variations and Change Orders: the VariationOrder aggregate, pending-vs-approved contract value, and separately-identifiable scope through the certify→invoice chain

## Context

Almost no ACCO project is built exactly as the original signed contract. Part-way through, the
client asks for an extra floor, a better finish, a moved wall, or drops scope. Each such change
usually moves three things at once — **price, scope, and completion date** — and today the system
has no way to record any of it. The BOQ knows only the original baselined scope (ADR-016) and the
Contract knows only the original `contractValue` (ADR-017); there is no affordance to change either
after the contract is active, and the deliberate absence of one has been noted repeatedly:

- ADR-016 defines the vocabulary term **Variation Item** (`sourceType = VARIATION`,
  `sourceChangeOrderId`) and the `VARIATION_REQUIRED` readiness blocker, and states plainly that
  *"The Variations module does not exist … `VARIATION_REQUIRED` … stays disabled behind a policy flag
  until Variations lands, rather than being invented now and reworked later."* The provenance fields
  `BoqNode.sourceType` / `BoqNode.sourceChangeOrderId` already exist in the schema (seeded Sprint 5),
  waiting for this aggregate to populate them.
- ADR-020 (CONST-BOQ-025) pre-authorises the routing: a post-baseline **New/changed client scope →
  Variation/ChangeOrder → BOQ revision**, and states the **cost↔revenue firewall** — *"a new cost
  never automatically becomes new client revenue"* — that this ADR must not break.
- ADR-017 (CONST-COM-001, Terminology) froze the commercial baseline as immutable and explicitly
  forbade the vocabulary *Revised / Current / Forecast Contract Value* until "the future Variation
  model" exists. It defers Variations by name.
- `docs/02-domain-boundaries.md` §6 records the same: *"After a contract leaves DRAFT, material
  contractual change should flow through a Variation … (Variation not yet built; provenance fields on
  BoqNode are prepared)."*

So the platform was deliberately *shaped around* this aggregate before building it. Eng Ahmed's
2026-08-27 memo now freezes the domain rules and unblocks the build. The hard part is not inventing a
new subsystem — it is making a `VariationOrder` **earn its place** by reusing the existing BOQ
revision, IPA/IPC certification, and DOA governance machinery, adding only what those cannot express:
a first-class, separately-identifiable change document with its own approval lifecycle, and a
pending-vs-approved distinction on contract value.

### What the frozen requirements say (Eng Ahmed, 2026-08-27)

1. A change is a **formal `VariationOrder`, approved before the work** — except the two controlled
   at-risk routes (Q7A/7B).
2. Contract value changes **only** on the required **client + contractual approval**. Until then the
   amount is reported as **Pending** and **must not be absorbed** into contract value.
3. **Omissions** (negative variations) are supported.
4. Approved variation scope bills through the **normal Progress→IPA→IPC→Invoice cycle**, with **each
   variation separately identifiable throughout** — no separate variation invoice.
5. Time impact is a **proposed** field only; the contractual completion date **never** moves
   automatically.
6. Governance reuses the **existing DOA thresholds** (ADR-022) — **no new authority matrix**.
7A. A project may begin **before the main contract is executed** — through a controlled route only.
7B. Urgent variation work **before the VO is finalised** — at-risk route only, never on informal
   verbal instruction; authorised by **Construction Director + CFO jointly**, escalating to the
   **CEO above an exposure cap**.

## Decision

This ADR freezes the rules below as `CONST-VAR-xxx`. They are design intent for a future build; each
names the existing machinery it reuses. Numbers are stable and future readers must not silently undo
the trade-offs they record.

### The `VariationOrder` aggregate

**CONST-VAR-001 — VariationOrder is a first-class aggregate that belongs to one Contract.**
A `VariationOrder` is a separately-identifiable change document owned by exactly one governing
`Contract` (which references one project and one BOQ). It carries its own identity and a
human-readable, per-contract sequential **reference** (e.g. `VO-003`, unique within the contract,
mirroring the `contractNumber` / `applicationNumber` per-parent numbering already used for IPA and
contracts). It is **not** a child of the Contract's frozen commercial baseline (ADR-017
CONST-COM-001) — it is the *sanctioned mechanism for changing* that baseline, and so it is its own
aggregate root with its own lifecycle, not a nested term. A VariationOrder never spans more than one
contract (see open question OQ-3).

**CONST-VAR-002 — A VariationOrder carries line items; additions and signed-negative omissions.**
A VariationOrder holds one or more line items, each describing a unit of changed scope (description,
unit, quantity, rate → line amount, using the same decimal-money and single-currency rules as the
BOQ, ADR-016 CONST-BOQ-013/014). A line's quantity/amount may be **negative** to express an
**omission** (client removes scope); the VO's proposed net price is `Σ line amounts` and may itself
be negative. There is no separate "omission" document type — an omission is a signed-negative
VariationOrder (memo Q3). Line items reference a **library item** (ADR-020 CONST-BOQ-020) where one
exists, exactly as ordinary BOQ entry does, so variation scope reuses the same work-item catalogue.

**CONST-VAR-003 — Proposed price and proposed time impact are proposals, not effects.**
A VariationOrder records a **proposed net price** (CONST-VAR-002) and an optional **proposed time
impact** (a number of days, or a revised proposed completion date). Neither is an effect until the VO
reaches the appropriate lifecycle state, and the time impact is **never** an effect automatically at
all (CONST-VAR-009). The words "proposed" are load-bearing: the figures on a VO in any pre-approval
state are the contractor's/client's *proposal*, carried for reporting as **Pending** (CONST-VAR-006).

**CONST-VAR-004 — VariationOrder lifecycle is a guarded-command state machine.**
The lifecycle, following the ADR-019 guarded-command pattern (readiness + governance + evidence +
audit, never a generic status dropdown):

```
DRAFT ──submit──▶ PENDING_INTERNAL ──DOA approve──▶ INTERNAL_APPROVED ──client accepts──▶ CLIENT_APPROVED
  │                     │                                   │
  └──withdraw──▶ WITHDRAWN         └──reject──▶ REJECTED     └──client rejects──▶ REJECTED
```

- **DRAFT** — free editing of lines / proposed price / proposed time impact (like a BOQ working
  draft, ADR-016). Not yet counted anywhere.
- **PENDING_INTERNAL** — submitted for ACCO's internal delegation-of-authority approval. Counts
  toward the **Pending variations** total (CONST-VAR-006). Editing of figures is closed; the VO is
  now under governance.
- **INTERNAL_APPROVED** — ACCO's DOA chain has approved committing to the VO (CONST-VAR-007). Still
  **not** in contract value — it is internally sanctioned but not yet a contractual change.
- **CLIENT_APPROVED** — the client + contractual approval required by memo Q2 is recorded. **Only now**
  does the VO count toward the governing contract value (CONST-VAR-005) and become eligible to enter
  the BOQ as priced work (CONST-VAR-008). Its figures **freeze** at this transition (CONST-VAR-010).
- **REJECTED** — declined internally or by the client; terminal; never counts toward contract value;
  retained for audit.
- **WITHDRAWN** — retracted by ACCO before a decision; terminal; retained for audit.

`REJECTED` and `WITHDRAWN` VOs remain readable but are commercially inert. There is no "un-approve":
reversing a `CLIENT_APPROVED` VO is itself a new (typically signed-negative) VariationOrder, never an
edit — the same immutability posture as an issued IPC (ADR-017) and a baselined BOQ (ADR-016).

### Contract value semantics

**CONST-VAR-005 — Governing contract value = original + Σ client-approved variations.**
The single governing (authoritative) contract value is:

```
governingContractValue = Contract.contractValue(original)  +  Σ (net price of CLIENT_APPROVED VariationOrders)
```

Omissions reduce it (their net price is negative). This is the figure every downstream
completeness/collection calculation compares against. `Contract.contractValue` (the original) is
**never mutated** — it remains the executed baseline; the governing value is **derived**, not stored
over the top of the baseline. This preserves ADR-017 CONST-COM-001 (immutable baseline) while giving
the product a truthful current value.

**CONST-VAR-006 — Pending variations are reported alongside, never folded in.**
The **Pending variations** total = `Σ (net price of VariationOrders in PENDING_INTERNAL or
INTERNAL_APPROVED)`. It is surfaced next to the governing value in the commercial summary read model
(ADR-017 Gate B) but is **never** added into `governingContractValue`. This is the direct expression
of memo Q2: *"the amount is reported as Pending and must not be absorbed into contract value"* until
client+contractual approval. The commercial summary therefore reports at least:
`Original Contract Value`, `Approved Variations (±)`, `Governing Contract Value`, and
`Pending Variations (memo only)`.

**CONST-VAR-006a — Terminology unlock.** This ADR *supersedes the ADR-017 terminology freeze* that
forbade *Revised / Current Contract Value* "until the future Variation model." That model is now this
ADR. The sanctioned vocabulary going forward is: **Original Contract Value**, **Approved Variations**,
**Governing Contract Value** (= the two summed), and **Pending Variations**. The terms
*Forecast Contract Value* and any client-facing figure that folds Pending into the total remain
**forbidden** — Pending is management information, not a contractual number.

### Separate identifiability through the certify→invoice chain (the hard modelling question)

**CONST-VAR-007 — A client-approved VariationOrder enters the BOQ as variation-tagged nodes on a new baseline revision.**
When a VariationOrder reaches `CLIENT_APPROVED`, its scope enters the project through the **existing
BOQ revision mechanism** (ADR-016 Revision = deep copy of the current Approved Baseline; ADR-020
CONST-BOQ-025 "Variation/ChangeOrder → BOQ revision"). The revision adds (or, for omissions,
zeroes/negates) the affected nodes; each node introduced or modified by the VO is written with
`sourceType = VARIATION` and `sourceChangeOrderId = <this VariationOrder's id>` — **the provenance
fields that already exist on `BoqNode` for exactly this purpose.** The revision then goes through the
**normal governed baseline approval** (ADR-016 CONST-BOQ-018, ADR-022 CONST-DOA-009 chain) to become
the new effective baseline. The contract's `boqVersionId` (the Contract Baseline, ADR-016) may be
repointed to the new baseline as a documented, audited administrative act, or left — that repoint is
the mechanism by which certification claims against the enlarged scope (see options + OQ-2).

**CONST-VAR-008 — Every certificate and invoice line traces to its VariationOrder through the BOQ node it references — no new tag is threaded through IPA/IPC/Invoice.**
This is the load-bearing decision. The certify→invoice chain already threads a single foreign key
end to end:

```
IpaItem.boqNodeId  ─▶  IpcItem (via applicationItem → the same IpaItem.boqNodeId)  ─▶  ClientInvoice (generated from the effective IPC)
```

Because every IPA line, every IPC line, and therefore every invoice line already resolves to a
**BoqNode**, and because a variation's nodes carry `sourceType = VARIATION` +
`sourceChangeOrderId` (CONST-VAR-007), **every certificate and invoice line is already traceable to
its originating VariationOrder by following the BOQ node it points at.** "Separately identifiable
throughout" (memo Q4) is satisfied by the provenance already on the node — the system need not add a
`variationOrderId` column to `IpaItem`, `IpcItem`, or `ClientInvoice`. Read models that must show
"which VO does this certified/invoiced line belong to" resolve `boqNodeId → BoqNode.sourceChangeOrderId
→ VariationOrder`. This keeps the change surface tiny and puts the tag in exactly one authoritative
place (the BOQ node), consistent with "BOQ owns scope" (ADR-016, domain-boundaries §1).

**CONST-VAR-009 — Time impact is proposed on the VO; moving the contractual completion date is a separate, explicit command.**
A VariationOrder's proposed time impact (CONST-VAR-003) **never** moves any date automatically, even
at `CLIENT_APPROVED` (memo Q5). Revising the contract's `expectedEndDate` is a **distinct, explicit,
audited command** — an *Extension of Time* action on the Contract — that a human invokes, may
reference one or more VOs as its justification, and records its own actor/reason/evidence. Approving
a VO and granting the time extension are two decisions, deliberately decoupled, exactly as ADR-023
CONST-COM-015 decouples "entitlement ready" from "invoice issued." The completion date is a
contractual fact; it moves only when a person with authority says so.

### Governance and the two at-risk routes

**CONST-VAR-010 — VariationOrder internal approval reuses the existing DOA value bands; a client-approved VO's figures freeze.**
Internal approval of a VariationOrder (`PENDING_INTERNAL → INTERNAL_APPROVED`) routes through
`CommandGovernanceService.gateStateTransition` on a `VariationOrder` governed entity (entityType is a
free-form string in the binding model — **no enum migration required**), using **amount-banded
`STATE_TRANSITION` bindings keyed on the VO's proposed net price**, exactly like PO approval
(ADR-022 CONST-DOA-005, `acco-value-bands.ts`). Memo Q6 is explicit: **no new authority matrix** —
the VO reuses ACCO's existing thresholds. The band evaluated on `|net price|` (absolute value, so a
large omission is governed like a large addition). On reaching `CLIENT_APPROVED`, the VO's line
items, net price, and proposed time impact become **immutable** (only its lifecycle-terminal
metadata and audit trail may extend).

**CONST-VAR-011 — The two at-risk commencement routes are controlled, audited exceptions — never the default.**

- **Route 7A — project begins before the main contract is executed.** This is a project-Start
  concern (ADR-019). The `ProjectReadinessPolicy` (CONST-PLC-005) already makes
  `ACTIVE_MAIN_CONTRACT` / `CONTRACT_START_DATE` **MANDATORY** conditions for a `CLIENT_CONTRACT`
  Start. Route 7A is a **controlled waiver of those specific conditions** via the existing
  condition-specific override (ADR-019 CONST-PLC-006: `override: { condition, reason, approvedBy }`,
  audited as `PROJECT_CONDITION_WAIVED`) — *not* a new bypass. The authority to grant that waiver is
  the Start chain's apex (CFO→CEO per CONST-DOA-006). No new machinery; a named, audited exception on
  the existing gate.

- **Route 7B — urgent variation work before the VO is finalised.** A VariationOrder may carry an
  **at-risk commencement authorisation**: an audited record that ACCO's **Construction Director and
  CFO jointly** authorise beginning the work while the VO is still `PENDING_INTERNAL` /
  `INTERNAL_APPROVED` (i.e. before `CLIENT_APPROVED`), escalating to **CEO** when the VO's exposure
  exceeds a **cap** (OQ-1 — the cap number is not in the memo). This is modelled as a **named fixed
  approval chain** in the ADR-022 style (`acco-lifecycle-chains.ts`): entityType `VariationOrder`, a
  dedicated `AT_RISK_COMMENCEMENT` transaction/decision, steps `[CONSTRUCTION_DIRECTOR, CFO]` below
  the cap and `[CONSTRUCTION_DIRECTOR, CFO, CEO]` above it. It is **never** satisfiable by informal
  verbal instruction (memo Q7B) — the authorisation is a governed, audited record or the work is not
  sanctioned. At-risk commencement does **not** change contract value or the BOQ; it only records who
  accepted the exposure. Contract value still waits for `CLIENT_APPROVED` (CONST-VAR-005).

### Invariants and the firewall

**CONST-VAR-012 — The cost↔revenue firewall and the guarded-command posture are preserved.**
Nothing in this ADR lets a *cost* become client *revenue* automatically (ADR-020 CONST-BOQ-025,
ADR-018 CONST-MATCH-013). A VariationOrder is a **revenue-scope** instrument: it changes what ACCO is
entitled to bill the client, and only through the human-approved lifecycle above. It is orthogonal to
the procurement/cost side (unplanned *cost* still routes through the ADR-020 cost branches, Sprint 7).
No transition in the VO lifecycle, the contract-value derivation, or the at-risk routes is automatic;
every one is a guarded command with governance and audit (ADR-008/011/019). AR settlement truth is
unchanged — variation revenue is real only when its invoice is **posted** (ADR-024, domain-boundaries
§2); a `CLIENT_APPROVED` VO enlarges *entitlement*, never the posted receivable directly.

## Considered options

### For CONST-VAR-007/008 — how approved variation scope becomes priced work and stays identifiable

- **Option A — variation-tagged nodes on a new BOQ revision (CHOSEN).** The VO's scope enters as
  `sourceType = VARIATION` nodes on a normal baseline revision; identifiability rides the existing
  `boqNodeId` foreign key already present on every IPA/IPC/invoice line. *Chosen* because it reuses
  ADR-016's revision mechanism verbatim, populates provenance fields the schema already carries, adds
  **zero** new columns to the certify→invoice chain, and keeps scope ownership in the BOQ where the
  domain boundaries put it. It respects baselined-BOQ immutability: original baseline nodes are never
  edited in place; the variation lands on a new immutable baseline (revision), and the superseded
  baseline stays valid only for historical read (ADR-016 CONST-BOQ-023).

- **Option B — a parallel "variation ledger" of priced lines outside the BOQ, referenced by IPA/IPC.**
  Rejected. It creates a **second scope-and-price model** beside the BOQ, forcing certification to sum
  two sources and re-introducing exactly the mixed-source ambiguity ADR-016 closed. It also duplicates
  the currency/decimal invariants and needs its own audit and readiness. Violates "BOQ owns scope"
  (domain-boundaries §1). More machinery for no capability the revision path lacks.

- **Option C — a `variationOrderId` column threaded through `IpaItem`, `IpcItem`, and `ClientInvoice`.**
  Rejected as redundant. The tag is already derivable from `boqNodeId → BoqNode.sourceChangeOrderId`;
  duplicating it onto three downstream tables creates three ways for the same fact to disagree (the
  classic multi-source-of-truth hazard ADR-024 ACC-SET-001 just removed for settlement). If a future
  reporting need proves the join is too expensive, a **denormalised** `variationOrderId` can be added
  later *as a cache of the node's provenance* — but it is not the source of truth and is not built now
  (subtraction ethos: introduce from evidence, not speculation).

- **Option D — edit the original baseline BOQ in place and bump `Contract.contractValue`.** Rejected
  outright — this is precisely the corruption ADR-016 CONST-BOQ-024 and ADR-017 CONST-COM-001 forbid,
  and it destroys the "each variation separately identifiable" requirement (Q4). Recorded only to mark
  it as a known-wrong path.

### For contract value (CONST-VAR-005/006)

- **Derive governing value; store nothing over the baseline (CHOSEN).** `contractValue` stays the
  executed baseline; governing value and pending total are computed from the VO set. Keeps a single
  writable source and a truthful derived view; matches how ADR-017 already derives Certified/Outstanding
  rather than storing them.
- **Mutate `Contract.contractValue` on each client-approved VO (rejected).** Loses the original
  baseline, breaks the ADR-017 immutable-baseline invariant, and makes "what was originally signed"
  unrecoverable without an audit reconstruction. The memo's "never absorbed until approved" is far
  safer expressed as a derivation than as an in-place mutation.

### For governance (CONST-VAR-010/011)

- **Reuse existing DOA value bands (CHOSEN).** Memo Q6 is explicit. The value-band engine
  (ADR-022 Phase 2/3) already routes a `STATE_TRANSITION` by document amount; a `VariationOrder` band
  set drops straight in.
- **A bespoke variation authority matrix (rejected).** Directly contradicts memo Q6 ("no separate
  variation authority matrix at this stage") and re-introduces the "second door into approvals"
  ADR-011 exists to prevent.

## Consequences

- **New aggregate, small blast radius.** A `VariationOrder` aggregate (root + line items +
  at-risk-commencement authorisation record) with its own module under
  `apps/api/src/business/construction/` following Clean Architecture (presentation / application /
  domain / infrastructure). It **reuses**: BOQ revision + provenance fields (already in schema), the
  IPA/IPC/invoice chain **unchanged** (CONST-VAR-008 adds nothing to it), `CommandGovernanceService` +
  value bands (ADR-022), the ADR-019 guarded-command + override pattern (7A), and the commercial
  summary read model (ADR-017 Gate B) — which gains three derived figures.
- **Schema additions (future build, not this ADR):** a `VariationOrder` table + line-item table +
  at-risk-authorisation record; `BoqNode.sourceChangeOrderId` becomes a real FK to it (today a bare
  string). No change to `Contract.contractValue`, `IpaItem`, `IpcItem`, or `ClientInvoice` columns.
- **Read-model additions:** the commercial summary exposes Original / Approved / Governing / Pending
  values (CONST-VAR-006); "trace this certified/invoiced line to its VO" resolves through `boqNodeId`.
- **`VARIATION_REQUIRED` blocker can be switched on.** ADR-016's parked readiness blocker
  (CONST-BOQ-024 / the "post-award origination not enforced yet" note) now has the aggregate it was
  waiting for.
- **Terminology unlock (CONST-VAR-006a).** ADR-017's temporary ban on *Revised/Current Contract Value*
  lifts, replaced by the fixed Original/Approved/Governing/Pending vocabulary above.
- **Firewall + immutability preserved.** No automatic cost→revenue; baselined BOQ and issued IPC stay
  immutable; a client-approved VO freezes; every transition is guarded and audited.
- **Blocked on open sub-questions.** The build must not guess the four items below; they return to
  Eng Ahmed in a follow-up memo (`docs/backend-requests/`) before the aggregate is implemented. None
  of them blocks *this* scoping ADR.

## Open sub-questions for a follow-up memo (not resolved by the 2026-08-27 memo)

- **OQ-1 — The 7B exposure cap number.** The memo says CD+CFO jointly authorise at-risk variation
  commencement, "escalating to the CEO above the exposure cap," but gives **no figure**. The
  `AT_RISK_COMMENCEMENT` chain (CONST-VAR-011) needs the USD cap that adds the CEO step. *(Do not
  reuse a PO band by assumption — at-risk exposure is a different risk class.)*
- **OQ-2 — Contract-Baseline repoint on a variation revision.** When a VO's revision becomes the new
  effective baseline, does the **Contract's `boqVersionId`** (the Contract Baseline, ADR-016)
  automatically follow, or is that a separate documented commercial act? This decides whether
  certification claims against variation scope require an explicit "adopt revision N into the
  contract" step. Engineering leans to an **explicit, audited repoint** (consistent with the
  guarded-command posture), but it is a domain choice.
- **OQ-3 — Can a VariationOrder span multiple contracts?** CONST-VAR-001 assumes one VO ↔ one
  contract. If ACCO ever issues a single client change spanning two contracts (e.g. a framework and a
  works package), the model needs a different root. Confirm one-contract-per-VO is sufficient for V1.
- **OQ-4 — Client-approval evidence requirements.** What constitutes the "client + contractual
  approval" that flips a VO to `CLIENT_APPROVED` (a signed VO document? a client PlatformFile
  attachment, ADR-014? a reference number)? This sets the evidence payload on the
  `INTERNAL_APPROVED → CLIENT_APPROVED` command and whether it is itself a governed transition.
