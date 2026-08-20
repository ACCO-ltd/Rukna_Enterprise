# Finance tab — refinement spec

Status: **Under-built. Backend mostly exists (ADR-013); refinement = surface it + project scoping.**
Owners: Backend — Abdulsalam · Frontend — frontend engineer.
Source of truth: ADR-013 (Project Actual P&L vs Financial Position), ADR-020 (BOQ backbone),
ADR-021 (physical progress), ADR-023 (collection).

## Purpose

The project **Finance tab currently points only at Project Actual P&L** (`/projects/[id]/pl`). The
richer **Project Financial Position** read model (ADR-013) is **built backend** (a
`project-financial-position-card` component exists) but is not a first-class tab view. Finance is
where the BOQ-backbone economic model culminates — plan vs cost vs revenue = margin — so the tab
should show the full project money picture, not just posted P&L.

## Two homes (same split as Procurement)
- **Org-level `/finance/accounting/*` (keep):** the **accountant's** double-entry workspace — CoA,
  journals, TB, P&L, BS, period close, year-end. Company-wide truth. Not duplicated per project.
- **Project Finance tab:** *this project's* money — a **reporting/lens** view (P&L + Financial
  Position + margin + signals). No journal posting here.

## Two views (the ADR-013 distinction that matters)
- **Actual P&L** — *posted GL only.* Backward-looking accounting truth (revenue / cost / gross / net).
  Already built + UI.
- **Financial Position** — *actual + open commitments + forecast.* Forward-looking **margin per BOQ
  node**: `budget (BOQ) · committed · accrued · actual · forecast · forecastMargin · variance`. Built
  backend (`GET /projects/:id/financial-position`); **promote to a first-class tab view.**

> P&L = what has hit the ledger; Financial Position = what the project will cost/earn once
> commitments land. PM steers margin with the second; the accountant reconciles the first.

## Management signals (cheap early-warnings, designed across the audit)
- **Physical vs financial** (Progress / ADR-021): "22% built / 51% cost consumed → investigate."
- **Collection vs progress** (Commercial / ADR-023): "collected 70% / built 22% → cashflow ahead of work."
Both belong on the Finance tab (and mirrored on Overview).

## Layout
```
FINANCE — Al-Baraka
Budget $4.82M (BOQ) · Committed $Y · Actual $Z · Forecast margin $M (n%)

[ Actual P&L ]   [ Financial Position ]

Financial Position (per BOQ node)  budget · committed · accrued · actual · forecast · margin · variance
Actual P&L (posted GL)             revenue · cost · gross · net

⚠ physical 22% / cost 51%      ⚠ collected 70% / progress 22%
```

## Refinement
1. **Promote Financial Position to a first-class Finance view** (it's built; a card exists — make it
   the primary view alongside Actual P&L).
2. **Lead with a position summary** (budget/committed/actual/forecast-margin) at the top of the tab.
3. **Add the two divergence signals** (physical-vs-financial needs Programme/ADR-021; collection-vs-
   progress is available from ADR-023 today).
4. **Keep the org accounting suite** as the accountant's separate workspace — correct target (ahead of
   ACCO's current QuickBooks maturity, but the right destination); do not project-scope journals/CoA.

## Dependencies
- Financial Position UI: no backend gap (ADR-013 read model built).
- Physical-vs-financial signal: needs **Programme/Progress** (ADR-021, not built) for verified physical %.
- Collection-vs-progress signal: available from ADR-023 (commercial) now.
