---
Status: accepted
---

<!-- Round-1 subtraction audit — Accounting stop (the last stop). Three domain premises confirmed
by ownership (Abdulsalam, on Eng Ahmed's behalf) 2026-08-20: USD-only forever; receipt settles an
invoice not a certificate; keep the posting-profile engine and extend it to AR. -->

# Accounting stop: single-currency USD, one settlement ledger, and posting-engine consistency

## Status note

This ADR records the outcome of the Round-1 subtraction audit's **Accounting stop** — the final
stop in the nav-order walk (Settings → Clients → Projects → Workspace/BOQ → Programme → Commercial
→ Procurement → Finance → Team → Documents → **Accounting**). The three domain premises were
**confirmed 2026-08-20** — (1) ACCO transacts in **USD only, always**; (2) a receipt settles a
posted **invoice**, never a certificate directly; (3) GL postings follow the standard
**posting-profile engine**, extended to AR (not per-scenario ad-hoc accounts). The engineering
shape is owned by Abdulsalam. Numeric tolerance seeds (item D) remain open — see the CEO memo
`docs/backend-requests/ceo-memo-bill-matching-tolerances.md`.

## Context

ACCO's accounting module is a full double-entry system (chart of accounts with effective-dated
`AccountVersion`s, `FiscalYear`/`AccountingPeriod` lifecycle, manual journals, GL + trial
balance/P&L/balance sheet, period close + snapshots), AR (invoices/receipts/allocations), AP
(bills/payments/allocations), a posting-rule engine, tax (5% VAT), and reconciliation/migration
scaffolding. The audit found three areas of weight and one inconsistency; the owner decisions are
recorded below. This ADR also resolves the audit's **second global cut** — USD/FX — and closes the
Round-1 audit walk.

## Decisions

### ACC-CUR-001 — Single currency (USD). The FX machinery is removed.
ACCO transacts in **USD only**: SOS is dead in-country and foreign trade is USD-denominated. The
multi-currency apparatus runs but is always trivial (rate = 1, base = transaction), and settlement
never actually converts — AR/AP merely *reject* currency mismatches. So it is dead weight.
- **Remove** `ExchangeRate` (table + rate resolution), the per-`JournalLine`
  `transactionCurrencyCode` / `transactionAmount` / `baseCurrencyAmount` / `exchangeRateSnapshot`
  (a line's amount *is* its USD amount), the `exchangeRate` / `reportingCurrencyCode` parameters on
  GRN/PO posting, and collapse `MonetaryPolicy` (base = reporting = USD is a constant, not config).
- **Keep** a single `currencyCode = 'USD'` marker on documents (invoices/bills/receipts) for
  display and report labelling, and the currency-mismatch guards as cheap always-true invariants.
- This is the sibling of the Arabic cut: a global subtraction that matches reality. Unlike the
  i18n seam, there is **no reason to keep an FX seam** — re-introducing multi-currency would be a
  new project, not a config toggle.

### ACC-SET-001 — One settlement ledger (invoice-based). A12 resolved.
Two receipt-settlement ledgers exist: the legacy `ReceiptAllocation` (receipt ↔ IPC certificate,
Sprint 3) and the authoritative `ClientReceiptAllocation` (receipt ↔ `ClientInvoice`, ADR-017).
ADR-017 already states the IPC ledger is **not** authoritative ("IPC must not maintain an
independent authoritative paid balance"). Two money-truths over one receipt is the A12 hazard.
- **Every receipt settles a posted invoice.** `ClientReceiptAllocation` is the sole settlement
  ledger. **Remove** `ReceiptAllocation`, `finance.service.allocate`-to-certificate, and the
  allocate-to-certificate endpoint. (Its frontend was never built, pending exactly this call.)
- Milestone billing already only ever uses the invoice ledger, so this unifies both billing models
  on one path.

### ACC-POST-001 — One posting path: the posting-profile engine, extended to AR.
The `PostingProfile` / `PostingRuleVersion` / `PostingRuleLineTemplate` engine is **kept** — ACCO's
postings are structured enough (projects, cost centres, retention, VAT) to justify a versioned,
configurable posting template. Today only **AP supplier-bill** posting uses it; **AR** (client
invoices/receipts) bypasses it and posts to explicit control-account codes resolved by
`accountSubtype`. This split is the inconsistency.
- **Wire AR through the posting-profile engine** too, so all GL postings are profile-driven and
  configurable. One consistent path, no hardcoded control-account resolution in AR.

### ACC-DEAD-001 — Drop dead migration scaffolding; keep the reconciliation control.
Grep-proven dead (0 callers): `SubledgerControlReconciliation`, `AccountingMigrationBatch`,
`PaymentReceiptMigrationException`.
- **Drop** `AccountingMigrationBatch` + `PaymentReceiptMigrationException` — legacy bulk-import
  scaffolding made redundant by the built `OpeningBalance` go-live feature.
- **Keep** `SubledgerControlReconciliation` on the roadmap — it is a genuine accountant control
  (subledger ↔ GL control-account tie-out), not import cruft; build it when the feature lands.

## Kept as-is (audited, earn their place)
`PostingAttempt` (posting idempotency/audit — used), `OpeningBalance` (go-live balances — built),
`TaxCode` / `TaxPolicy` (5% VAT — used), `FiscalYear` / `AccountingPeriod` + `FiscalCalendarPolicy`
(period lifecycle — used).

## Consequences
- **Schema migration** drops `ExchangeRate`, `MonetaryPolicy`, `ReceiptAllocation`,
  `AccountingMigrationBatch`, `PaymentReceiptMigrationException`, and the four multi-currency
  columns on `JournalLine`. Posting DTOs (GRN/PO) lose their rate/reporting-currency fields.
- **Posting engine** gains an AR path; `client-invoice.service` / `customer-receipt.service` stop
  taking raw control-account codes and resolve through a profile version instead.
- **Firewall preserved.** None of this changes the cost↔revenue firewall or the guarded-command
  posture; it removes weight and unifies two half-systems.
- Build order is decided separately; ACC-CUR-001 (single-currency) is the largest, highest-value
  slice and the natural first, mirroring the Arabic removal.

## Out of scope / still open
- Numeric over-receipt / matching **tolerance seed values** (audit item D, ADR-018) — flat global,
  values pending Eng Ahmed.
- Customer-receipts **frontend** (create + allocate-to-invoice screen) — unblocked by ACC-SET-001.
- Somali or any second currency — explicitly not seamed; a future project if ever needed.
