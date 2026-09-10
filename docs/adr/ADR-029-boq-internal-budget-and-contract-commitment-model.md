---
Status: accepted
---

<!-- Accepted 2026-09-10: 7 owner decisions (D1–D7) + the three open decisions (CONST-BOQ-032/033/034)
signed off with Eng Ahmed; architecture APPROVED; spec + tickets published. The §0 in-place
COMMITTED/SNAPSHOT mechanism (see boq-workspace-redesign-spec.md) is the accepted implementation shape. -->


# BOQ as ACCO's internal budget: contract commitment, contingency, and the change taxonomy

## Context

The BOQ module shipped and matured under ADR-016 (workspace contract), ADR-020 (economic
backbone / item library / change model) and ADR-026 (variations). Those ADRs modelled the
BOQ as a **client-facing priced bill** whose baselined total is a separate figure from the
negotiated contract value, versioned through DRAFT → BASELINED → SUPERSEDED with a
user-visible version history and a "create revision" flow.

A grilling session with the product owner (2026-09-10, `/grill-with-docs` on the BOQ
workspace redesign) established that this does not match how ACCO actually works:

- **The BOQ is internal, not client-facing.** The client sees only the **contract sum**
  and the milestone invoices (ACCO bills 40/30/20/10 against contract value — ADR-023).
  The BOQ is ACCO's private cost/budget plan.
- **The contract sum is the anchor; the BOQ is built to reflect it.** ACCO agrees a price
  (e.g. 500k) with the client, then allocates that 500k across the BOQ. So BOQ total and
  contract value must **tie out**, not "differ legitimately" as ADR-016 stated.
- **ACCO carries a deliberate buffer**, historically by padding line rates (booking 40k of
  labour where 10k is real). That buffer protects against overruns without reopening the
  price with the client — but smeared into rates it blinds cost control and, because
  progress rolls up value-weighted by line amount (ADR-021), it distorts the progress %.
- **"Versions" are unwanted.** ACCO wants one living BOQ they can always correct, with a
  history of who changed what — the "QuickBooks feel" — not a version dropdown or a
  re-baseline ceremony for a typo.
- **Extra work is estimated on the BOQ**, then classified by who pays. The current
  placement of Variations wholly inside Commercial forces re-entering already-priced scope.
- **ACCO is lump-sum to the client.** Actual site quantities never re-price the client;
  quantity differences are internal cost variance. The client's number moves only through
  an agreed variation.

This ADR records the resulting model. It **supersedes** the ADR-016 boundary that "a BOQ
total must never replace or overwrite contract value; they are separate figures that may
legitimately differ," reframes the ADR-016 version vocabulary, and makes concrete the
post-baseline change model that ADR-020 (CONST-BOQ-024/025) left abstract. It is
`proposed`: the decisions are owner-approved, but an architecture pass and implementation
plan are still owed, and several modules (Contract, Commercial/Variations, Progress,
Finance) are affected.

## Decision

### Domain vocabulary — fixed

| Term | Definition |
|---|---|
| **Working BOQ** | The one living, always-editable BOQ before commitment. No versions; edits are free and recorded in history. |
| **Committed BOQ** | The BOQ after the single **Commit to contract** action. Still internally editable (budget/corrections), but its **contract value is fixed**. |
| **Contract value** | What the client owes under the signed contract. Equal to the committed BOQ total, plus any on-contract variations. Fixed at commit; moves only via an approved variation. |
| **Total client revenue** | Everything the client pays for the project: contract value **+** separate charges. May exceed contract value. |
| **Contingency / Preliminaries allowance** | A named BOQ line/pool holding the internal buffer. Drawn down to cover overruns and absorbed scope. Never smeared into work rates. |
| **Variation (on-contract)** | Client-paid extra scope folded into the contract; raises the contract value; requires client approval via Commercial. |
| **Separate charge** | Client-paid extra billed as a one-off outside the contract; contributes to Total client revenue but **not** to contract value. |
| **Absorbed scope** | Extra work ACCO funds itself from contingency; contract value unchanged; no client charge. |
| **As-committed snapshot** | An immutable frozen copy of the whole BOQ taken at commit and at each approved variation — the legal record of "what the client signed." Not a user-browsable version. |

### Rules

**CONST-BOQ-026 — The BOQ is ACCO's internal budget and ties out to the contract value.**
The BOQ is an internal cost/budget plan, not a client-facing priced bill. Its total is
allocated to equal the contract value (`Working BOQ total == contract value` at commit).
Client billing remains milestone-based on the contract value (ADR-023); no per-BOQ-line
client billing is implied. This supersedes the ADR-016 boundary that BOQ total and contract
value are independent figures.

**CONST-BOQ-027 — One living BOQ; commitment replaces baseline; snapshots are the record.**
There is exactly one BOQ per project and no user-facing versions, revision flow, or version
dropdown. A single **Commit to contract** action fixes the contract value. Before commit,
edits are free and audited; after commit, the BOQ stays editable for internal budget while
the contract value is locked. Immutable **as-committed snapshots** are captured at commit
and at each approved variation for the legal trail, surfaced to the user as a history
timeline and a single **compare-to-signed** view — never as browsable peer versions. The
existing `BoqVersion` machinery is retained internally as the snapshot mechanism.

**CONST-BOQ-028 — Contingency is a named allowance, never smeared into rates.**
The internal buffer is held as an explicit **Contingency / Preliminaries** line/pool.
Work lines carry their real budget so cost control and value-weighted progress (ADR-021)
stay honest. Overruns and absorbed scope are funded by an audited draw-down from the pool,
which shows a running "contingency remaining."

**CONST-BOQ-029 — Post-commit change taxonomy.**
After commit, exactly four things may happen to the BOQ:
1. **Money-neutral correction** (typo, description, code, reorder) — free + audited.
2. **Internal reallocation / contingency draw** — budget moves between lines, contract
   value unchanged — free + audited, contingency bar updates.
3. **Absorbed scope** — new line funded from contingency, marked not-billable, contract
   value unchanged.
4. **Client-paid extra** — classified as either a **Variation (on-contract)** which raises
   the contract value and routes to Commercial for client approval, or a **Separate charge**
   which leaves the contract value untouched.
Extra scope is estimated **on the BOQ** and classified by a two-step "who pays / how"
choice; only the on-contract variation moves the contract value, and only through the
governed Commercial approval. This makes ADR-020 CONST-BOQ-024/025 concrete.

**CONST-BOQ-030 — Two figures: contract value vs total client revenue.**
The system tracks and displays **contract value** and **total client revenue** as distinct
numbers. Absorbed scope and separate charges are recorded but never alter the contract
value. Contract value = in-contract scope + contingency + on-contract variations.

**CONST-BOQ-031 — Lump-sum client billing.**
ACCO contracts are lump-sum: the client pays a fixed contract value via milestones,
independent of actual measured quantities. Quantity differences are internal cost variance
against the cost budget, not a client re-pricing. The client's value moves only via an
approved variation. The deferred remeasurement affordance is therefore not required.

## Considered alternatives

- **Keep BOQ total and contract value independent (ADR-016).** Rejected: it does not match
  ACCO, where the BOQ *is* the internal allocation of the agreed contract sum and must tie
  out. An untied BOQ total is a number nobody uses.
- **Keep the padded-rate buffer as-is.** Rejected: it blinds profitability and corrupts the
  value-weighted progress roll-up. A named contingency allowance gives the identical
  financial protection while staying legible (CONST-BOQ-028).
- **Pure history log, nothing frozen at commit.** Rejected: without an as-committed snapshot
  there is no defensible record of contracted scope in a dispute. The snapshot is kept but
  hidden behind a timeline so the "one BOQ" experience is preserved (CONST-BOQ-027).
- **Move Variations out of Commercial entirely.** Rejected: raising the contract value is a
  client-facing commercial act that must be governed and approved. Only the *trigger* moves
  to the BOQ; approval and billing stay in Commercial.
- **Remeasurable client billing.** Rejected for ACCO (CONST-BOQ-031); they are lump-sum and
  bill milestones on a fixed sum.

## Consequences

- **`Contract.contractValue` becomes derived from / validated against the committed BOQ
  total**, rather than a freely-typed figure. Contract creation must read the BOQ; a
  contract below the tied-out BOQ total is rejected.
- **A new "Total client revenue" figure** must be surfaced on the project/commercial
  read models, distinct from contract value, aggregating separate charges.
- **The `BoqNode` model needs a commercial classification** for post-commit additions
  (in-contract / variation / separate / absorbed / contingency) beyond the existing
  `sourceType`. Contingency needs a first-class representation rather than a normal priced
  line.
- **The variation flow reverses direction:** trigger and pricing originate on the BOQ and
  push to Commercial (ADR-026) for approval, instead of scope being re-entered in Commercial.
- **The BOQ workspace UI is redesigned** around one screen with three life-stages
  (Working → Committed → varying), a money band, a contingency drawdown, an add-extra-work
  classifier, and a history timeline with compare-to-signed. Version panel / create-revision
  UI is retired. See `docs/design/boq-workspace-redesign.md`.
- **`measurementMethod`/`pricingBasis`, decimal money, readiness, governed transition, dense
  order (ADR-016 CONST-BOQ-013..018) all stand.** The governed transition seam (ADR-011)
  now gates **Commit to contract** and **variation approval** rather than an abstract
  "baseline."
- **Capability roles (ADR-020 CONST-BOQ-022) gain urgency**: the BOQ now carries margin
  (contract value vs expected cost / contingency), so who may *see* margin and who may
  *commit* or *approve a variation* must be settled in the architecture pass.
- **An architecture pass is owed** before implementation, and the domain specifics
  (variation billing under milestone schedules, expected-cost tracking depth) should be
  confirmed with Eng Ahmed.

## Resolution of open decisions (2026-09-10, with Eng Ahmed)

The architecture pass (`docs/design/boq-workspace-redesign-architecture.md`) surfaced three
blocking decisions; all resolved with Eng Ahmed. Verdict: **APPROVED**.

**CONST-BOQ-032 — Contract value is three layered figures; the milestone schedule is frozen.**
An on-contract variation does **not** re-spread the payment schedule. The milestone `%`
derive from a **`baseContractValue` frozen at commit**; `currentContractValue = base + Σ
approved on-contract variations`; `totalClientRevenue = current + Σ separate charges`. A
variation is certified and billed as its **own identifiable line** (e.g. `VO-001`) attached to
the certificate/invoice of the stage in which it completes — never merged into the milestone
amount. (Corrects the current `installmentAmount = % × contractValue` to derive from
`baseContractValue`.)

**CONST-BOQ-033 — Separate-charge scope lives in the BOQ, classified and tracked.**
`commercialTreatment = SEPARATE_CHARGE` lines are real BOQ nodes (excluded from the tie-out
via the `IN_CONTRACT` filter) so their cost codes to `boqNodeId` and progress tracks them.
ACCO tracks cost and progress on pay-now extras.

**CONST-BOQ-034 — BOQ access model.** Capabilities `view:boq`, `edit-scope:boq`,
`edit-cost:boq`, `commit:boq` (replaces `baseline:boq`), `manage-contingency:boq` — kept
technically separate, co-assignable to one person today. Three server-enforced visibility
tiers: Operational (scope+progress) / Cost-control (`view-cost:boq`, +budgets/rates) /
Commercial-Executive (`view-margin:boq`, +contract value, contingency reserve, margin,
profitability). Commit-to-contract and variation approval are **governed transitions with
prepare≠approve four-eyes** via `CommandGovernanceService` + the ADR-027 DOA engine (not
hardcoded). Contingency draw is a commercial-authority act. This realises ADR-020
CONST-BOQ-022. Full profitability is a cross-aggregate read assembled in the Finance
financial-position model, gated by `view-margin`.

Remaining non-blocking: expected-cost depth (rely on `ProjectCostBudget` for the first cut);
confirm whether PMs may draw contingency directly up to a limit vs commercial-only.
