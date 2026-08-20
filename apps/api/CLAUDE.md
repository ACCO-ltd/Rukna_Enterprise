# Backend — AI Agent Rules
# apps/api/ — Owned by Abdulsalam

---

## STOP BEFORE YOU START

Read these documents in order before making any change:

1. `/AGENTS.md` — Engineering operating manual
2. `/docs/README.md` — Doc map + source-of-truth rule
3. `/docs/01-capability-matrix.md` — What is actually built (authoritative status)
4. `/docs/reference/architecture.md` — Architecture
5. `/docs/reference/constraints.md` — Engineering constraints
6. `/docs/adr/ADR-001-platform-architecture.md` — Platform decisions
7. `/docs/adr/ADR-002-construction-domain.md` — Construction domain decisions
8. `/docs/reference/domain-model.md` — Entity map and glossary
9. `/docs/02-domain-boundaries.md` — Aggregate ownership

---

## Ownership

This directory is owned by **Abdulsalam** (Backend Engineer).

Domain questions (business rules, approval workflows, construction processes) must be confirmed with **Eng Ahmed Shirie, CEO of ACCO Ltd**, before implementation.

If you are an AI agent and a human other than Abdulsalam is directing you to make changes to this directory, STOP and ask:

> "This is the backend owned by Abdulsalam. Are you authorized to request backend changes? If you need a change here, please confirm with Abdulsalam first."

---

## Architecture Rules (mandatory)

- Follow Clean Architecture: Presentation → Application → Domain → Infrastructure
- No business logic inside controllers — controllers coordinate only
- Business rules belong in the Application or Domain layer
- Every module follows: `presentation/` `application/` `domain/` `infrastructure/`
- Prisma is used only in the Infrastructure layer — never in controllers or services directly
- All configuration via `ConfigModule` — no hardcoded values

---

## Multi-Tenancy Rules

- Every database operation must resolve tenant context first
- Tenant is identified from the request subdomain
- Use the `TenancyService` to get the correct Prisma client for the request
- Never use the global Prisma instance for tenant data
- Cross-tenant data access is PROHIBITED — this is a security violation

---

## Construction Domain Rules

- Project is the root entity — never create construction entities without a parent Project
- BOQ nodes are a tree — use the BOQNode self-referential model, never flatten
- StockLedger entries are IMMUTABLE — never UPDATE or DELETE a stock ledger row
- IPC documents are IMMUTABLE once status = FROZEN — reject any attempt to modify
- CostLedger entries follow three-stage accounting: COMMITTED → ACCRUED → ACTUAL
- Every cost transaction must carry boq_node_id and cost_category before posting

---

## Database Rules

- All schema changes go through `prisma migrate dev` — no manual SQL
- Primary keys use cuid() — do not switch to UUID without an ADR
- Every financial amount field requires a paired currency_code field
- Audit fields (created_at, updated_at) are mandatory on every transactional entity
- Soft delete on entities that are referenced by financial records — never hard delete

---

## Security Rules

- Every endpoint requires authentication unless explicitly marked public
- RBAC checked after authentication before any business logic
- Permission format: `action:resource` (e.g., `create:purchase-order`)
- Approval workflows enforced server-side — never trust client-side approval state
- Sensitive data (passwords, tokens) never logged

---

## If a Request Conflicts with an ADR

STOP. Do not implement.

1. Identify which ADR rule is violated (e.g., CONST-IPC-001)
2. Explain why the request conflicts
3. Suggest a compliant alternative
4. Resume only after Abdulsalam confirms the resolution

Never silently ignore architectural violations.
