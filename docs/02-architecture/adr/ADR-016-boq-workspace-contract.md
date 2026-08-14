---
Status: accepted
---

# The BOQ workspace contract: one currency, decimal money, explicit readiness, governed baseline

## Context

The BOQ aggregate shipped in Sprint 2 and has been extended twice (ADR-004 versioning,
ADR-005 measurement fields) without a review pass. An audit against the running code found
that the module is the outlier in every dimension the rest of the platform has since settled:

- **Money is floating point.** `BoqTreeService.computeLeafTotal` does
  `Math.round(quantity * unitRate * 100) / 100` and `sumTotals` accumulates `Number(...)`
  into a JS double, while the columns are `DECIMAL(18,2)` and every other construction and
  accounting module uses `Prisma.Decimal` with string serialization. Recorded as **B7**.
- **Currency is per node and unconstrained.** `BoqNode.currency` is a nullable `VarChar(3)`
  with no sibling or aggregate constraint, so a single BOQ can hold mixed currencies and
  `sumTotals` will happily add them into one meaningless number. Recorded as **D1**; the
  frontend works around it by withholding parent totals.
- **Sibling order has no uniqueness guarantee.** `moveNode` writes the moved node's
  `sortOrder` and never reindexes, so ties are storable and read order is undefined.
  Recorded as **B13**. Reordering is disabled in the UI as a result.
- **Nothing distinguishes "editable" from "ready".** A BOQ with zero items, duplicate
  codes, or items missing a rate can be baselined — and a baselined version is what a
  contract references and what every IPC claims against.
- **The most contractually significant transition in the module is ungoverned.**
  Baselining is gated by a permission only. BOQ is absent from `GovernedEntity` and
  `BoqModule` imports no workflow.
- **`measurementMethod` and `pricingBasis` cannot be set.** The columns exist and
  `api-reference.md` documents them, but no DTO accepts them and `forbidNonWhitelisted`
  rejects them. Every node in the system is permanently `QUANTITY` / `UNIT_RATE`.
  Recorded as **C9**.
- **No response contract is shared.** `packages/types` exports no BOQ DTO; the web app
  hand-maintains its own copies. Recorded as **B12**.
- **The module has no tests.** It is the only construction module in that state.

Separately, the frontend workspace is being rebuilt to the Project Workspace design
language. That rebuild needs business state — pricing completeness, readiness blockers,
contract-baseline reference, revision delta — that no endpoint currently returns, and it
must not compute any of it client-side, because the same judgements decide whether the
server permits a baseline.

## Decision

### Domain vocabulary — fixed

| Term | Definition |
|---|---|
| **Working Draft** | The single editable `BoqVersion` with `status = DRAFT`. At most one per BOQ, pointed at by `Boq.currentDraftVersionId`. |
| **Approved Baseline** | A `BoqVersion` with `status = BASELINED`. Permanently immutable. Pointed at by `Boq.currentApprovedVersionId`. |
| **Contract Baseline** | The specific baselined version referenced by `Contract.boqVersionId`. Not necessarily the current approved baseline — a later revision may have superseded it without the contract moving. |
| **Revision** | A Working Draft created as a full deep copy of the current Approved Baseline, each node carrying `originNodeId` back to its source (CONST-BOQ-007). |
| **Variation Item** | A node with `sourceType = VARIATION` and a `sourceChangeOrderId`, introduced or modified through an approved Variation Order. |
| **Pricing Complete** | Every billable item in the version has a unit, a quantity, a rate, and the BOQ currency. |
| **Baseline Ready** | Structurally valid, Pricing Complete, at least one billable item, no duplicate codes, and permitted by the project lifecycle. |

"Billable item" means `isLeaf = true`. Sections (`isLeaf = false`) are structural and are
never billable.

### Architecture boundaries

- BOQ owns **scope structure and pricing**. Nothing else writes a `BoqNode`.
- Contract owns the **negotiated contract value**. A BOQ total must never replace or
  overwrite contract value; they are separate figures that may legitimately differ.
- Programme owns **time and progress**.
- Procurement and Accounting **reference** BOQ nodes as a cost dimension. They never
  mutate them.
- **Financial visibility is enforced by the server.** Rate and amount fields are omitted
  from responses for callers without commercial visibility, rather than hidden by the UI.
- All BOQ mutations remain project- and organization-scoped.

### New rules

**Rule CONST-BOQ-013 — One currency per BOQ.**
`Boq.currency` is authoritative and required, seeded from `Project.currency` at
initialization. Every node either carries that currency or none; a node presenting any
other currency is rejected. Aggregate totals are therefore always meaningful. This closes
D1 and retires the frontend's mixed-currency suppression.

**Rule CONST-BOQ-014 — Decimal arithmetic, string serialization.**
`quantity × unitRate = lineAmount`, `Σ child amounts = section amount`, and
`Σ root sections = BOQ total` are computed with `Prisma.Decimal`, never JS numbers.
Quantities carry 3 decimal places, rates and amounts 2. Every monetary and quantity value
crosses the wire as a **string**, matching `IpaResponse` and `IpcResponse`. This closes B7
and the `computedTotal`-as-number inconsistency.

**Rule CONST-BOQ-015 — Structural validity.**
Within a version: item `code` is unique; a section carries no `unit`, `quantity`,
`unitRate` or `currency`; an item may not have children; quantity and rate are
non-negative and within scale; no node may become its own ancestor; tree depth is bounded.
Violations are rejected at write time, not discovered at baseline.

**Rule CONST-BOQ-016 — Baseline readiness is explicit and single-sourced.**
A version may be baselined only when Baseline Ready. The readiness judgement lives in one
policy that both the readiness query and the baseline command call, so the screen and the
server can never disagree. Blockers are returned per node so they can be acted on, not
merely counted.

**Rule CONST-BOQ-017 — Sibling order is dense and unique.**
`(versionId, parentId, sortOrder)` is unique. A move relocates the node and its
descendants atomically and reindexes both the source and destination sibling ranges to a
dense `0..n-1` sequence. `path` remains structural and `sortOrder` presentational, as
CONST-BOQ-008 requires — reindexing never rewrites a path. This closes B13 and unblocks
reordering in the UI.

**Rule CONST-BOQ-018 — Baselining is a governed state transition.**
`DRAFT → BASELINED` routes through `CommandGovernanceService.gateStateTransition` on the
`BoqVersion` governed entity, exactly as ADR-011 specifies for procurement and AP. With no
binding configured the gate resolves to `null` and baselining proceeds unchanged;
configuring a binding turns on four-eyes approval without a code change. Attribution
(`preparedBy`, `submittedBy`, `baselinedBy`, `derivedFromVersionId`) is persisted on the
version.

### Renumbering

ADR-005 reused **CONST-BOQ-010**, which ADR-004 had already assigned to "stable node IDs
in path". ADR-005's pair is renumbered:

| Was (ADR-005) | Now |
|---|---|
| CONST-BOQ-010 — `measurementMethod` / `pricingBasis` added to `BoqNode` | **CONST-BOQ-011** |
| CONST-BOQ-011 — `measurementMethod` is a leaf property; items map to leaf nodes only | **CONST-BOQ-012** |

ADR-004's CONST-BOQ-010 stands.

## Considered alternatives

- **Currency on the Project rather than the BOQ.** Simpler, and true today. Rejected
  because the BOQ is the aggregate that sums money, and an aggregate that cannot state its
  own unit of account cannot validate its own children. `Boq.currency` is seeded from the
  project and is expected to equal it; making it explicit means the invariant is checked
  where it is used.
- **Compute readiness in the frontend.** Everything needed is derivable from the tree, and
  this would have shipped the screen sooner. Rejected: the same judgement gates the
  baseline command, and two implementations of a rule that decides whether a contract can
  be signed will diverge. The frontend renders the server's verdict.
- **A dedicated BOQ approval workflow.** Rejected in favour of the existing ADR-011 seam.
  A second door into approvals is precisely what ADR-011 was written to prevent.
- **Soft-delete every node.** Rejected as over-broad. Draft-only hard delete stays; the
  block applies when a node is referenced by a downstream record, which is what
  CONST-BOQ-003 actually protects.

## Consequences

- **`computedTotal` changes type from `number` to `string`.** This breaks the web client
  and must land together with the frontend work, not before.
- **`GET /boq/workspace` is a deliberately deep query.** It returns state assembled from
  the BOQ, its versions, the contract reference and the readiness policy in one response,
  because the alternative is a screen that assembles business meaning from four endpoints
  and gets it subtly wrong. It is a read model, not a resource.
- **Existing mixed-currency rows are not silently re-denominated.** If any exist, they
  surface as a `CURRENCY_MISMATCH` readiness blocker and must be corrected by a human.
  Rewriting a rate's currency is a commercial decision, not a migration.
- **Post-award origination (CONST-BOQ-001) is specified but not enforced yet.** The
  Variations module does not exist. `VARIATION_REQUIRED` is defined as a readiness blocker
  kind and stays disabled behind a policy flag until Variations lands, rather than being
  invented now and reworked later.
- **Excel interoperability is deferred.** The import/export column mapping must follow
  ACCO's actual workbook. Defining a template before seeing it guarantees rework, so no
  import affordance ships in the meantime — a disabled control is worse than an absent one.
