# Rukna — System Map (the mental model)

Read this first. It explains *what the system is* before you read *how any part is built*.
Do **not** try to understand Rukna as "Sprint 1 → 2 → 3…". Sprints are a delivery log; they are
a bad mental model. Understand it by **domains and business flows**.

## The whole platform on one page

```
                         RUKNA ERP
                            │
        ┌───────────────────┼────────────────────┐
   PLATFORM            CONSTRUCTION            FINANCE
   FOUNDATION             CORE               / ACCOUNTING
        │                   │                    │
        │           ┌───────┼────────┐           │
        │          BOQ  Contract  Commercial    GL / AR / AP
        │                   │                    │
        │         IPA → IPC → Invoice → Receipt  │
        │                                         │
        └──────── Procurement ────────────────────┘
                     │
              MR → PO → GRN → Bill
                     │
              Commitment Ledger
                     │
                 (Inventory)  ← not built
```

## The central reduction

```
SCOPE      → BOQ
TIME       → Programme            (not built)
PROGRESS   → Measurements         (not built)
REVENUE    → Contract → IPA → IPC → AR
COST       → MR → PO → GRN → (Inventory) / Bill
FORECAST   → Commitments + Actuals + Remaining work
ACCOUNTING → Every financial event → GL
CHANGE     → Variation controls scope / time / value   (not built)
GOVERNANCE → RBAC + DOA + Audit wrap every sensitive command
PROJECT    → Connects all of the above WITHOUT owning all of it
```

## Project is the scope, not a God object

`Project` is the central business scope and reporting root — the *container/context*, not one
giant object owning everything. It connects separate aggregates, each with its **own** lifecycle
and invariants:

```
Project.status  ≠  Contract.status  ≠  PO.status  ≠  IPA.status
```

See `docs/02-domain-boundaries.md` for who owns which fact.

## Three business flows

Everything sensible in the system is one of these three flows. Full detail in
`docs/03-business-flows.md`.

- **Flow A — Scope & Revenue** (client-facing): what we promised, what we did, what we can bill.
  `Client → Project → BOQ → Contract → work → IPA → IPC → Invoice → Receipt`.
- **Flow B — Procurement & Cost**: what we need, ordered, received, owe, and what it cost.
  `Need → MR → PO → GRN → Bill → Payment`, financially `COMMITTED → ACCRUED → ACTUAL`.
- **Flow C — Accounting**: the legally correct financial position.
  `Business event → Posting rule → Journal → GL → Trial Balance → P&L / Balance Sheet`.

**Commercial ≠ Accounting.** An IPC certifying $100k is a commercial fact; whether an AR invoice
was posted, to which account, in which period, with which VAT, is an accounting fact.

## Two ledgers, kept deliberately separate

| General Ledger | Commitment Ledger |
|---|---|
| `JournalEntry → JournalLine` | `CommitmentLedgerEntry` |
| Actual revenue/expense, assets, liabilities, equity, statutory P&L, balance sheet | PO commitments, received-not-billed exposure, procurement cost progression |
| Answers *"what happened?"* (CFO) | Answers *"what will this project probably cost once commitments land?"* (PM) |

`CommitmentLedgerEntry` is **not** merged with `JournalLine`. That separation is intentional.

## The construction control triangle

```
                SCOPE (BOQ ✓)
                     ▲
                    / \
                   /   \
              TIME ----- COST
          Programme    Procurement ✓
          (not built)  Commitments ✓
                       Actuals ✓
```

Today the system knows *what to build* (BOQ ✓) and *what money is spent* (Procurement +
Accounting ✓), but not fully *what was physically built, when, against which planned activity*
(Programme/Progress ✗). That is the strategic gap.

## What NOT to build next

Do **not** start HR, Payroll, Retail, Manufacturing, or CRM. The Construction vertical still
lacks a complete operating loop. Starting another vertical now produces a *wide ERP with shallow
domains* — worse than one deep, coherent vertical. Close the loop first (in dependency order):

1. **Programme & Progress**  2. **Inventory** (stock issue → project consumption)
3. **Variations**  4. **Subcontracts**

See `docs/01-capability-matrix.md` for exactly what is and isn't built.

## Who asks what (where data belongs)

| Role | Asks | Domain |
|---|---|---|
| CEO | Are projects profitable? Cash exposure? Which are late? | Cross-domain reporting |
| PM | What's delayed? What's committed vs actual? Forecast final cost? | Project controls |
| QS / Commercial | Contract value? What can we claim / was certified? Retention held? | Commercial |
| Procurement | What's requested / approved / ordered / arrived? Bill mismatches? | Procurement |
| Finance | What's posted? Who owes us? Bank balance? Can the period close? | Accounting |
