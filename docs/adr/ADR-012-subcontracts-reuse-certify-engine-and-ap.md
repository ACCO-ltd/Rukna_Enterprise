---
Status: accepted
---

# Subcontracts reuse the certification engine and the AP party/rails; they are not a parallel system

## Context

A main contractor subcontracts most of its work. A subcontract is a contract ACCO is on the
*paying* side of — its own BOQ, certificates, retention and advance recovery — the mirror of a
client contract. Today the schema anticipates this with placeholders only: `ContractKind
{ CLIENT_CONTRACT, SUBCONTRACT }`, a `SUBCONTRACT_CERTIFICATE` workflow-transaction type, and a
`SUBCONTRACT_COST` category — but no entities, no call sites, and `contractKind` currently only
toggles the one-client-contract-per-project uniqueness check. `Contract.clientId` is non-nullable
with no `supplierId` column, so a `SUBCONTRACT` row cannot even be pointed at a subcontractor yet.

## Decision

**One certification engine, direction chosen by `contractKind`.** Reuse the existing IPA/IPC
cumulative-certification aggregate (cumulative claimed/certified quantity, current-period,
BOQ measurement, retention, advance recovery, variance reasons, supersession, immutable history)
for both client and subcontract certification. `contractKind` selects direction:
`CLIENT_CONTRACT` → receivable-side (→ ClientInvoice → AR); `SUBCONTRACT` → payable-side
(→ SupplierBill → AP). The branch lives **only at the financial posting boundary** — the
certification arithmetic is direction-agnostic. `SUBCONTRACT_CERTIFICATE` stays a workflow/UI
label, not a second aggregate.

**A subcontractor is a `Supplier`, not a new party type.** Reuse `SupplierProfile` and the AP rails
(supplier ledger, AP control, matching, payments, aging, tax) already wired and fixed. Add a
`supplierType { MATERIAL | SUBCONTRACTOR | BOTH }` discriminator on Supplier rather than forking
the party. Richer subcontractor data, if it ever arrives (licence, trade, HSE, prequalification),
is a `SubcontractorProfile` extension *on top of* SupplierProfile — never a parallel AP ecosystem.

## Consequences

- **Do not rename IPA/IPC.** The `PaymentApplication`/`PaymentCertificate` rename is a migration
  against a frozen, immutable, 87-test aggregate with a supersession partial-unique index; solve the
  domain *labels* at the DTO/UI layer and derive direction from `contractKind`. Any physical rename
  is a cosmetic pass long after subcontracts, not a prerequisite.
- **Reuse `BillingModel` (already on Contract) as the certification-method axis** — do not add a
  `CertificationMethod` enum. Eng Ahmed's answer (measured vs milestone vs lump-sum) lands in
  `billingModel` on the subcontract row.
- **The load-bearing new work is the commitment, not the certificate.** A subcontract award is the
  AP-side equivalent of a PO and must be a CommitmentLedger source (award → COMMITTED, certificate →
  ACCRUED, bill posted → ACTUAL). The certificate→SupplierBill path is the *non-PO bill path*, which
  by design touches neither the match gate nor the commitment ledger — so without this, project
  committed-cost is silently understated. This plumbing is shared with project budget-vs-committed
  reporting.
- **The mirror is maturity-lopsided:** AP posting works today; AR posting (IPC→ClientInvoice→GL) is
  Sprint 8. A subcontract certificate can therefore reach the GL before a client IPC can — the
  conservative direction (cost recognized, revenue deferred), and the *more* shippable half.
- **Migration:** make both counterparty FKs nullable under an XOR (`clientId` XOR `supplierId`),
  generalize the frozen snapshot columns to counterparty snapshots. `parentContractId` (back-to-back
  linkage to the head contract) is flagged, not built, pending confirmation ACCO uses back-to-back terms.

## Open — belongs to Eng Ahmed

Does ACCO certify subcontractor work cumulatively against measured BOQ quantities, with retention and
advance recovery, substantially as client IPCs are certified? If yes, reuse is clean. If subcontracts
are milestone/lump-sum, the engine still reuses AP + SupplierProfile, but `billingModel` drives a
non-measured certification path.
