---
Status: accepted
---

<!-- Domain-approved by Eng Ahmed Shirie 2026-08-17 (see ADR-022). Item D (numeric tolerances +
     exception-approval authority) RESOLVED by Eng Ahmed memorandum 2026-08-27 — see the "Item D
     resolved" note below. -->

# Bill matching: control invariants, per-dimension verdict, and exception resolution

## Item D resolved — tolerances + exception-approval authority (Eng Ahmed, 2026-08-27)

ADR-018/ADR-024 **item D** (the previously flat/wrong-defaults tolerance seed) is closed. The engine
(`bill-matching.service.ts`) now enforces:

- **Platform fallback: price 2% / quantity 0%** (was 5%/5%). Quantity 0% means *pay against the
  accepted/received quantity only* — no over-bill beyond the reference quantity is tolerated (the
  existing cumulative-billed-vs-received mechanism; only the % changed). A `MatchingTolerancePolicy`
  (org/PO scope) still overrides the fallback.
- **Over-receipt stays 5%** — a *separate* `OverReceiptPolicy` on goods receipts, untouched.
- **USD-5 tolerance is per invoice, not per line.** After per-line verdicts are derived, a would-be
  EXCEPTION caused **only** by price/amount rounding is absorbed into `MATCHED_WITH_TOLERANCE` when
  the bill's **total** amount variance is ≤ USD 5 (`PER_INVOICE_ROUNDING_ABS`). A **quantity
  over-bill is never absorbed** by the $5 (accepted-quantity only), regardless of dollar size. The
  per-line variance figures are retained for display; the $5 changes the verdict, not the numbers.
- **Enforcement holds:** `POSTABLE_MATCH_STATUSES` still blocks `EXCEPTION` from posting
  ("Approve the exception before posting"). Blocked, visible, **never auto-rejected** (Q5).
- **Exception-approval authority by amount (Q6):** Finance Manager (ACCO role `FINANCE_OFFICER`) may
  approve a matching exception when the bill total ≤ **USD 1,000**; above that requires **CFO** (CEO
  apex also authorised). Enforced in the application layer (`approveException` / `resolveException`
  APPROVE path) against the approver's `roles`, reusing ACCO's existing $1,000 DOA boundary — **no**
  new governance binding was introduced (see follow-up below). A sub-CFO approver over the band gets
  a 403.

**Governance follow-up (non-blocking):** the authority is enforced directly against roles rather than
routed through `CommandGovernanceService` amount bands, because matching-exception approval is not a
`GovernedEntity` state transition and wiring one would need a new binding + amount-band seed. If a
future need arises to make this a full approval *chain* (multi-step / delegated), add a
`WorkflowBinding` for the matching-exception command and route it through the DOA engine like POs and
payments.

## Status note

**Implementation — Phase 1 (control closure): DONE.** The engine now evaluates quantity, price and
amount **independently** and stores a per-dimension verdict (CONST-MATCH-003); the overall verdict is
derived and any out-of-tolerance dimension makes the bill an **`EXCEPTION`**, which the existing
posting gate blocks (CONST-MATCH-004). Three-way quantity is judged against **received** (cumulative
accepted), and matching is **cumulative** across bills on the same PO line, so a supplier can neither
bill more than received nor split the full quantity across invoices (CONST-MATCH-005/006). A flat
platform-default tolerance makes the control hold without waiting on the D4/D5 numbers (tunable per
org via `MatchingTolerancePolicy`).

**Implementation — Phase 2a (resolution spine): DONE.** Exception reasons are now a defined enum
(`MatchExceptionReason`, CONST-MATCH-007), and the reason fixes the resolution path
(CONST-MATCH-008): `POST /procurement/bill-matching/:billId/resolve` routes a structured reason —
APPROVE reasons (rounding / freight / other) → `APPROVED_EXCEPTION` (posts); a supplier invoice error
→ the new terminal `DISPUTED` status, which never posts (CONST-MATCH-009); an agreed price change / PO
quantity change / receipt correction keeps the bill an `EXCEPTION` with the required action recorded,
until the correction + a re-match clears it. Reason, action, resolver, time and notes are recorded on
the match as the audit trail (CONST-MATCH-014). The legacy free-text `approve-exception` endpoint is
retained (records an `OTHER`/`APPROVE` resolution) so the current UI keeps working.

**Implementation — Phase 2b (rematch loops): DONE. ADR-018 is now fully implemented.** Matching now
runs against the PO's **current active revision** (not the revision the bill was created against) and
re-points the bill to it. So the resolution loops close:
- **AGREED_PRICE_CHANGE / PO_QUANTITY_CHANGE** (CONST-MATCH-010/011): the user creates + approves a PO
  revision — which recommits the ledger to the new exposure on approval (existing PO-approve flow) —
  then re-runs matching, which picks up the revised terms against the recommitted exposure and clears
  the exception.
- **RECEIPT_CORRECTION** (CONST-MATCH-012): received quantity is summed **by material across the whole
  PO** (all posted GRNs, any revision), so a corrected/additional GRN is reflected on re-match and a
  price-only revision never loses the received quantity.
- **CONST-MATCH-013** (supplier↔client firewall): no build — a supplier-side cost change never touches
  client billing.

Remaining follow-on (not part of ADR-018): the Round-2 matching **UI** surfaces these controlled
decisions; the current tab already reads the backend result.

This ADR records the **target** design for supplier bill matching. It extends and **corrects**
ADR-007's tolerance rules (`MATCH-001`, `MATCH-002`). The engineering shape is owned by
Abdulsalam; the **business rules** (tolerance meaning, mandatory PO revision, the
supplier↔client firewall) are domain decisions and must be confirmed with **Eng Ahmed Shirie
(CEO, ACCO Ltd)** before implementation begins (`apps/api/CLAUDE.md`). Until then this is
`proposed`, not a build authorization.

## Context

A code audit of the running matching engine (`business/procurement/bill-matching/
application/bill-matching.service.ts`) found that the capability, marked `BACKEND` in the
capability matrix, has **real control gaps** — it looks finished but the control does not
hold:

- **The verdict is a single boolean.** `withinTolerance = qtyOk && priceOk` collapses the
  dimensions. `amountVariance` is computed and stored but **never evaluated** — the amount
  dimension is unenforced.
- **"Three-way" matching does not use the receipt.** Quantity variance is `billedQty −
  poOrderedQty`; the accepted GRN quantity is fetched and stored but **excluded from the
  tolerance decision**. It is a two-way match wearing a three-way label.
- **Matching is invoice-isolated, not cumulative.** A supplier can bill the full PO quantity
  on two separate bills; each passes in isolation.
- **The gate is toothless.** Out-of-tolerance lines are labelled `MATCHED_WITH_TOLERANCE`
  (never `EXCEPTION_PENDING`), and the posting gate permits `MATCHED_WITH_TOLERANCE` to post.
  Out-of-tolerance bills therefore post freely.
- **Reasons are free text.** No structured reason, no resolution workflow, no defined
  accounting consequence.

These gaps must be closed before the Round-2 matching UI is built, because the UI's job is to
*surface* a controlled decision — and there is not yet a reliably controlled decision to
surface. This ADR freezes the invariants the engine, receiving, AP, commitments, and the UI
must all obey.

## Decision

The matching engine **detects and quantifies** discrepancies. It does **not** decide business
consequences. A structured **resolution** step, chosen by a user, routes each exception into a
controlled workflow. The rules below are enforced in backend domain/application code; the
frontend displays backend results and never re-implements them (constraints §10, §20).

### Frozen matching invariants

- **CONST-MATCH-001 — Truthful receipt.** The physical received/accepted quantity is always
  recorded exactly as it arrived. Matching never alters recorded physical reality.
- **CONST-MATCH-002 — Tolerance never hides variance.** A tolerated difference is retained and
  visible with its exact figures (percent and absolute). Auto-accepted is never rendered as a
  bare `MATCHED`; it is `MATCHED_WITH_VARIANCE` carrying the numbers and the policy version
  that cleared it.
- **CONST-MATCH-003 — Independent dimensions.** Quantity, price, and amount are each evaluated
  against tolerance independently and stored independently:
  `quantityWithinTolerance`, `priceWithinTolerance`, `amountWithinTolerance` — each with its
  variance. The single `withinTolerance` boolean is **retired** as canonical truth.
- **CONST-MATCH-004 — Derived overall verdict.** The line verdict is derived, not primary:
  `overallVerdict = (all required dimensions within tolerance) ? MATCHED : EXCEPTION`. Any
  required dimension outside tolerance makes the **whole line** an exception — never a
  partial/percentage "50% matched".
- **CONST-MATCH-005 — Payable bounded by receipts.** Supplier billing cannot create payable
  quantity unsupported by received quantity. Payable is bounded by `min(billed, cumulative
  received)`; excess is blocked from payable, in **both** directions (over-bill and
  short-receipt).
- **CONST-MATCH-006 — Cumulative matching.** Matching considers previously billed/matched
  quantities against the same PO line. It is cumulative across bills, not isolated to one
  invoice.
- **CONST-MATCH-007 — Structured reasons.** Exception reasons are values of a defined enum,
  never free text.
- **CONST-MATCH-008 — Reason drives resolution + consequence.** Each reason permits a defined
  resolution path and accounting treatment. The **treatment** is defined by the reason; the
  **specific GL account** is resolved from accounting configuration/posting policy, not
  hardcoded in the enum.
- **CONST-MATCH-009 — Disputed excess is not posted.** A `SUPPLIER_INVOICE_ERROR` resolution
  rejects/disputes the bill; the disputed excess is never posted.
- **CONST-MATCH-010 — Agreed price increase above tolerance requires a PO revision.** A
  material agreed price change beyond tolerance cannot be absorbed with a note. It requires an
  approved PO revision. Within-tolerance differences may be absorbed per policy while remaining
  visible and auditable.
- **CONST-MATCH-011 — Commitment updated before match completes.** An approved PO revision
  updates the commitment ledger to the new exposure **before** the invoice is re-matched and
  posted. A note explains history; it does not repair the commitment ledger.
- **CONST-MATCH-012 — Receipt errors correct the GRN.** A `RECEIPT_CORRECTION` resolution
  corrects the GRN (with an audit event) and triggers a re-match. Matching never silently
  overrides the receipt.
- **CONST-MATCH-013 — Supplier↔client firewall.** A supplier-side cost change never
  automatically changes the client contract or client billing. Passing cost to the client
  requires the separate commercial mechanism (variation / price escalation / remeasurement, as
  the contract permits). `Supplier $8 → $9` never implies `Client BOQ $10 → $11`.
- **CONST-MATCH-014 — Auditable resolution.** Every exception resolution records actor, reason,
  timestamps, affected values (before/after), and the resulting action.

### Canonical exception reasons (CONST-MATCH-007/008)

| Reason | Resolution path | Accounting treatment (account from posting policy) |
|---|---|---|
| `ROUNDING_VARIANCE` | Auto-clear when within tolerance | Absorb; posted at billed value, variance retained |
| `SUPPLIER_INVOICE_ERROR` | Reject/dispute; supplier re-submits | Disputed excess **not** posted |
| `AGREED_PRICE_CHANGE` | PO revision required when above tolerance → approve → recommit → rematch | Posted at revised PO price |
| `FREIGHT_OR_ADDITIONAL_CHARGE` | Approve additional cost | Posted as additional cost to the account derived from accounting policy |
| `RECEIPT_CORRECTION` | Correct GRN → audit → rematch | Follows corrected receipt |
| `PO_QUANTITY_CHANGE` | PO revision → approve → recommit → rematch | Posted at revised PO quantity/commitment |
| `OTHER` | Manual approval | Explicit accounting treatment recorded on resolution |

## Considered options

- **Absorb agreed price increases with a note (rejected).** Leaving the commitment at the old
  price while everyone knows the real exposure is higher makes the commitment ledger and
  Project Financial Position lie (`PO commitment $80,000` vs `supplier reality $90,000`).
  Rejected in favour of a mandatory PO revision above tolerance (CONST-MATCH-010/011).
- **Simplify the tolerance model to a flat org policy (deferred).** The per-supplier /
  per-category / effective-dated tolerance hierarchy (ADR-007 `MATCH-002`) is **kept but left
  dormant**: seed one flat global rule, expose no hierarchy UI. The valuable sophistication is
  the *control chain* (detect → quantify → explain → approve/correct → update commitment →
  post → audit), not per-supplier tolerance tuning. **Review trigger:** if per-supplier /
  per-category tolerances remain unused six months after go-live, simplify the model then.
- **Keep the single `withinTolerance` boolean (rejected).** Too lossy — you learn a match
  failed but not cleanly why. Replaced by per-dimension outcomes + a derived verdict
  (CONST-MATCH-003/004).

## Consequences

- **This is corrective work, not new scope.** Closing CONST-MATCH-003/004/005/006 and the
  gate defect (out-of-tolerance must become `EXCEPTION_PENDING`, which the posting gate must
  **block**) changes the engine's verdict and status logic and the `SupplierBillMatchLine`
  shape (per-dimension flags). A migration is required.
- **New surfaces:** an exception-resolution command/workflow (detection vs resolution
  separation), a structured reason enum, and the PO-revision → recommit → rematch loop
  (reuses immutable PO revisions and `CommitmentLedgerWriter`).
- **Cross-module contract.** These invariants bind Procurement, Receiving (GRN), AP
  (SupplierBill), Commitments, Project Financial Position, and the Round-2 UI. The UI surfaces
  the controlled decision; it does not compute it.
- **Gated on domain sign-off.** Implementation waits on Eng Ahmed's confirmation of the
  business rules (tolerance meaning, mandatory PO revision, the supplier↔client firewall).
- **Capability matrix correction.** The "Bill Matching — `BACKEND` ✓" row is stale: the
  control does not currently hold. The matrix note must be updated to reflect these gaps.
