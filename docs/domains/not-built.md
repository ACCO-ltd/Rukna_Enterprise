# Domains — Not Yet Built

These are real domain capabilities, not just missing screens. Listed in the dependency order in
which they should be built to complete the Construction operating loop. Authoritative status:
`docs/01-capability-matrix.md`.

## 1. Programme & Progress — `POLICY_FROZEN / DESIGN_READY / NOT_IMPLEMENTED` (highest priority)

The authoritative *time* and *physical completion* domain: schedule, activities, baseline
programme, progress updates, measurements/evidence, delay/variance. Without it, IPA valuation is
manual rather than measured, and the control triangle (Scope–Time–Cost) is missing its Time
vertex. ACCO policy is frozen and the delivery specification is in
[`programme-progress-delivery-spec.md`](programme-progress-delivery-spec.md). No models or
Programme ADR exist yet.

## 2. Inventory / Site Stores — `NOT_DESIGNED`

Warehouses/site stores, stock ledger (receipt/transfer/issue/return/adjust), valuation.
**Closes the physical-to-financial loop:** issuing material to site is what creates project
consumption/cost. Until this exists, a purchase can be committed/accrued/actual but never
attributed as project *consumption*. No models, no ADR.

## 3. Variations / Change Management — `DESIGNED` (blocked)

Change request → evaluation → internal approval → client approval → BOQ effect + time effect +
contract-value effect. Maintains integrity between original scope/price and current values.
`BoqNode.sourceType`/`sourceChangeOrderId` provenance is prepared; there is **no** `ChangeOrder`
aggregate. BLOCKED on Eng Ahmed's decision (#51).

## 4. Subcontracts — `DESIGNED`

Subcontractor contract + subcontract BOQ + application + certificate + retention/advance, wired
to AP and the Commitment Ledger. Design in **ADR-012** (reuse the certify engine + AP). No code.

## 5. Project Cost Control — `PARTIAL`

Budget / committed / accrued / actual / consumed / forecast / variance / final-cost forecast.
Financial Position already covers actual + committed + forecast margin; missing pieces are a
**budget baseline** and **consumed** (needs Inventory).

## 6. Site Operations — `NOT_DESIGNED`

Daily reports, measurement sheets, inspections/evidence, labour, equipment.

## 7. Document Control — `NOT_DESIGNED` / storage `DESIGNED`

Register, revisions, approvals, transmittals, relationships, file versions. Platform file
storage is designed in **ADR-014** (`PlatformFile`) but not built — only per-entity attachment
*metadata* rows exist (`ContractAttachment`, `IpaAttachment`, `IpcAttachment`,
`GuaranteeAttachment`, `JournalEntryAttachment`); nothing stores or serves a file.

## 8. Notifications / Alerting — `NOT_DESIGNED`

Expiring guarantee, overdue approval, delayed activity, overdue invoice, PO delivery overdue,
GRN exception, unallocated receipt, suspended project. Only a domain policy stub exists
(`platform/notifications/domain/notification-event.policy.ts`) — no persistence or delivery.

## Other verticals — `NOT_DESIGNED`

Retail and Manufacturing are empty module stubs. Logistics, Commercial Real Estate, and
Construction Consulting are vision-only. **Do not start another vertical until the Construction
loop is complete** (see `docs/00-system-map.md`).
