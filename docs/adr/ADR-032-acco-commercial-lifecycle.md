---
Status: accepted
Date: 2026-09-19
Owner approval: Eng Ahmed Shirie
---

# ACCO commercial lifecycle: live BOQ to commercial close

## Decision

ACCO's commercial journey has one human-facing sequence:

`Create BOQ → Record Signed Contract → Execute Work → Extra Work → Verify → Review → Ready to Bill → Prepare → Issue → Send → Collect → Final Account → Commercial Closed`.

One backend journey resolver must drive the top journey indicator, primary CTA, Current Position,
and Overview. Screens must not derive competing next actions.

## Signed-contract boundary

The BOQ is ACCO's live working document and remains editable throughout the project. There is no
user-facing **Commit BOQ** or **Commit to contract** action.

Recording the physically signed main client contract is one business command. It:

1. records the negotiated signed value and dates;
2. creates the payment schedule;
3. takes an immutable **Signed BOQ snapshot** from the live BOQ;
4. creates the main client contract as `ACTIVE`;
5. freezes signed evidence and client identity facts.

The live BOQ and signed value may legitimately differ. The snapshot records signed scope; the
contract stores the negotiated financial agreement.

## Extra work

- **Absorb:** internal BOQ scope; no contract or invoice change; no automatic contingency draw.
- **Variation:** requires the single active main client contract, client approval reference, and BOQ
  section. It raises current contract value and creates a new immutable snapshot. It does not invoice.
- **Separate charge:** leaves contract value unchanged and creates a draft one-off invoice that must
  still pass through Prepare, Issue, Send, and Collect.

The operator never enters a contract ID. Zero active contracts is a guided business error; multiple
active contracts is a configuration conflict.

## Billing and collection

Physical verification, commercial readiness, invoice issuance, delivery, and payment are distinct
facts. Issued invoices are immutable, milestone and variation invoices receive independent numbers,
delivery history is append-only, and payment allocation is exactly what the operator confirms.

## Superseded decisions

This ADR supersedes the conflicting portions of ADR-029 and the commercial workspace design specs:

- manual `WORKING → COMMITTED` BOQ transition;
- `commit:boq` as a user journey requirement;
- mandatory BOQ-total/contract-value tie-out at signing;
- “Committed BOQ” terminology in user-facing screens;
- contract creation that leaves the main signed contract in `DRAFT`;
- immediate issuance of a separate-charge invoice.

The internal `BoqVersion` and snapshot infrastructure remains for history and legal evidence. Existing
historical records are preserved; this decision removes the obsolete ceremony, not the audit trail.

## Compatibility and migration

Existing draft client contracts must be reviewed explicitly; they are not auto-activated because
activation asserts that a physical signed agreement exists. Existing committed BOQ versions remain
readable and may serve as historical snapshots.

## Verification

The required end-to-end acceptance path is:

`Live BOQ → record ACTIVE signed contract + snapshot → edit live BOQ → approved variation → verified milestone → ready → prepare → independently numbered invoices → delivery → partial payment → paid → commercial summary`.
