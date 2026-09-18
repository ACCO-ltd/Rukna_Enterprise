# Slice 3 Domain Invariants — FROZEN

**Date:** 2026-09-17  
**Status:** FROZEN — these invariants must not change during Slice 4 or later slices without explicit domain review.

---

These are the stable truths of the commercial readiness model as agreed at the close of Slice 3B. Slice 4 (invoice preparation UI) builds on top of them; it does not reopen them.

| # | Invariant |
|---|-----------|
| 1 | `VERIFIED` does not imply `READY TO BILL`. A physically-done milestone still requires an explicit commercial readiness action. |
| 2 | `READY TO BILL` requires an explicit human action (`contractsManage` permission). It is never set automatically by domain events. |
| 3 | Readiness can be revoked at any point before an invoice exists. |
| 4 | Once an invoice exists, readiness becomes a historical record and cannot be revoked. |
| 5 | Marking ready-to-bill never creates money entries, accounting postings, variation allocations, or progress mutations. |
| 6 | Outstanding unpaid invoices on earlier installments do not block readiness on a later one. |
| 7 | Installment amount = `percentage × baseContractValue`. Readiness does not alter this figure. |
| 8 | Variations remain separate from milestone base amounts. Readiness applies to the milestone installment, not to its co-billed variations. |
| 9 | Billing requires both physical eligibility (programme milestone `VERIFIED` if linked, or unlinked) **and** commercial readiness (`readyToBillAt != null`). Neither alone is sufficient. |

---

## Permission boundary

The domain uses two distinct permission levels; current organisational practice is one mapping of these, not a fixed requirement:

| Permission | Governs |
|------------|---------|
| `contractsManage` | Commercial readiness review — mark ready / revoke |
| `receivablesManage` | Invoice issuance — `billStage` / `issuePackage` |

Role-to-permission mapping (e.g. "finance manager holds `contractsManage`") is an ACCO organisational policy, not a domain constraint. The domain never encodes named roles into the billing workflow.

---

## What remains open for Slice 4

- Invoice preparation UI: wire `PrepareInvoiceDialog` to real `billStage`, using `canPrepareInvoice` flag.
- `paymentTermsDays` on `CommercialContractSummary`.
- Credit note flow for omissions on already-invoiced stages.
