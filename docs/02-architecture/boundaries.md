# Team Boundaries and Module Ownership

Version: 1.0.0
Status: Active
Last Updated: 2026-07-30

---

## Team

| Role | Name | Owns | Contact for |
|---|---|---|---|
| Backend Engineer | Abdulsalam | `apps/api/`, `prisma/schema.prisma`, `packages/types/` | All backend changes, API contracts, database schema, domain model questions |
| CEO / Domain Expert | Eng Ahmed Shirie | ACCO Ltd business processes | All construction domain logic questions, approval workflow design, business rule clarifications |
| Frontend Engineer | (assigned) | `apps/web/` | UI/UX, component design, frontend state, accessibility |

---

## File Ownership Map

```
Erp_platfrom/
│
├── apps/
│   ├── api/           ← BACKEND — owned by Abdulsalam
│   │   ├── src/
│   │   ├── prisma/    ← DATABASE SCHEMA — owned by Abdulsalam
│   │   └── .env
│   │
│   └── web/           ← FRONTEND — owned by Frontend Engineer
│       └── src/
│
├── packages/
│   ├── types/         ← SHARED TYPES — owned by Abdulsalam
│   │                     (frontend reads, backend writes)
│   ├── ui/            ← SHARED UI — owned by Frontend Engineer
│   ├── config/        ← SHARED CONFIG — either engineer, ADR required for changes
│   ├── eslint/        ← SHARED LINTING — either engineer
│   └── tsconfig/      ← SHARED TS CONFIG — either engineer
│
├── docs/              ← DOCUMENTATION — both engineers maintain
├── AGENTS.md          ← AI AGENT RULES — both engineers maintain
└── docker-compose.yml ← INFRA — Abdulsalam
```

---

## Boundary Rules

### RULE BOUND-001 — Frontend engineers do not modify backend files

The following paths are outside the frontend engineer's ownership:

- `apps/api/**`
- `apps/api/prisma/schema.prisma`
- `packages/types/src/**`
- `docker-compose.yml`
- `.env` files in `apps/api/`

If the frontend requires a change in any of these paths, the engineer must:

1. Create a GitHub issue describing the needed change
2. Tag Abdulsalam for review
3. Wait for approval before proceeding

Do not implement backend changes directly. Do not assume the API will behave differently than what is currently documented.

---

### RULE BOUND-002 — API contracts are owned by the backend

The API response shapes, endpoint paths, authentication headers, and error formats are defined by the backend and consumed by the frontend.

If the frontend needs a different response shape:
1. Raise it with Abdulsalam
2. Abdulsalam updates the API and `packages/types/`
3. Frontend consumes the updated types

The frontend must not work around the API by calling undocumented endpoints or relying on undocumented response fields.

---

### RULE BOUND-003 — Database schema changes require backend approval

`prisma/schema.prisma` is the single source of truth for the database. No changes to this file may be made by the frontend engineer or by any AI agent acting on behalf of the frontend engineer.

All schema changes:
- Require an ADR if they affect module boundaries
- Require Abdulsalam's approval
- Must be followed by a migration (`prisma migrate dev`)
- Must be reviewed against all ADRs before merge

---

### RULE BOUND-004 — Domain logic questions go to the domain experts

If a business rule is unclear — how retention is calculated, what triggers an IPC, what approval steps apply to a PO — do not guess. Stop and escalate:

- **Technical / API question** → Abdulsalam
- **Business / construction domain question** → Eng Ahmed Shirie (CEO, ACCO Ltd)

Implementing incorrect business logic is worse than implementing nothing. Construction ERP errors cost real money.

---

### RULE BOUND-005 — Shared packages require both engineers to agree on changes

Changes to `packages/config/`, `packages/tsconfig/`, or `packages/eslint/` affect both apps. Both engineers must review before merging.

---

## Module Ownership (Backend)

| Module | Path | Owner | Status |
|---|---|---|---|
| Auth | `apps/api/src/platform/auth/` | Abdulsalam | ✅ Built |
| Users | `apps/api/src/platform/users/` | Abdulsalam | ✅ Built |
| Organizations | `apps/api/src/platform/organizations/` | Abdulsalam | ✅ Built |
| Roles | `apps/api/src/platform/roles/` | Abdulsalam | ✅ Built |
| Permissions | `apps/api/src/platform/permissions/` | Abdulsalam | ✅ Built |
| Audit Logs | `apps/api/src/platform/audit-logs/` | Abdulsalam | ✅ Built |
| Multi-tenancy | `apps/api/src/platform/tenancy/` | Abdulsalam | ✅ Built |
| DOA / Workflows | `apps/api/src/platform/workflows/` | Abdulsalam | ✅ Built |
| Construction — Projects | `apps/api/src/business/construction/projects/` | Abdulsalam | ✅ Built |
| Construction — Contracts | `apps/api/src/business/construction/contracts/` | Abdulsalam | ✅ Built |
| Construction — BOQ | `apps/api/src/business/construction/boq/` | Abdulsalam | ✅ Built |
| Construction — Client Billing | `apps/api/src/business/construction/billing/` | Abdulsalam | ✅ Built |
| Accounting — Core (COA, FY, Bank, OB) | `apps/api/src/business/accounting/accounting-core/` | Abdulsalam | ✅ Built |
| Accounting — Manual Journals | `apps/api/src/business/accounting/manual-journals/` | Abdulsalam | ✅ Built |
| Accounting — Accounts Receivable | `apps/api/src/business/accounting/accounts-receivable/` | Abdulsalam | ✅ Built |
| Accounting — Accounts Payable | `apps/api/src/business/accounting/accounts-payable/` | Abdulsalam | ✅ Built |
| Accounting — General Ledger & Reports | `apps/api/src/business/accounting/general-ledger/` | Abdulsalam | ✅ Built |
| Procurement — Material Catalogue | `apps/api/src/business/procurement/catalogue/` | Abdulsalam | Planned Sprint 5 |
| Procurement — Material Requests | `apps/api/src/business/procurement/material-requests/` | Abdulsalam | Planned Sprint 5 |
| Procurement — Purchase Orders | `apps/api/src/business/procurement/purchase-orders/` | Abdulsalam | Planned Sprint 5 |
| Procurement — Goods Receipts | `apps/api/src/business/procurement/goods-receipts/` | Abdulsalam | Planned Sprint 5 |
| Procurement — Bill Matching | `apps/api/src/business/procurement/bill-matching/` | Abdulsalam | Planned Sprint 5 |
| Procurement — Commitment Ledger | `apps/api/src/business/procurement/commitment-ledger/` | Abdulsalam | Planned Sprint 5 |
| Construction — Variations | `apps/api/src/business/construction/variations/` | Abdulsalam | Planned Sprint 6 |
| Construction — Subcontracts | `apps/api/src/business/construction/subcontracts/` | Abdulsalam | Planned Sprint 6 |
| Construction — Inventory | `apps/api/src/business/construction/inventory/` | Abdulsalam | Planned Sprint 7 |
| Construction — Job Costing | `apps/api/src/business/construction/costing/` | Abdulsalam | Planned Sprint 7 |
| Construction — Site Execution | `apps/api/src/business/construction/site/` | Abdulsalam | Planned Sprint 9 |
