# Enterprise ERP Platform
## Software Architecture Document (SAD)

Version: 5.0.0

Status: Active — Sprint 5 complete (Post-Sprint 5 architecture review done)

---

# 1. Purpose

This document defines the official software architecture for the Enterprise ERP Platform.

Its purpose is to ensure every engineer builds the system using the same architectural principles, constraints, terminology, and design decisions.

This document is the single source of truth for architectural decisions.

No engineer may introduce architectural changes without team agreement and an Architecture Decision Record (ADR).

---

# 2. Vision

Build a modern enterprise ERP platform that is:

- Modular
- Maintainable
- Secure
- Scalable
- Auditable
- Extensible
- Cloud Ready
- API First

The platform must support multiple industries while sharing one common platform.

Current business domains include:

- Construction & Contracting
- Retail
- Manufacturing
- Logistics

Future domains include:

- Commercial Real Estate
- Construction Consulting

---

# 3. Architecture Goals

The architecture must prioritize:

1. Long-term maintainability
2. Business correctness
3. Developer productivity
4. Security
5. Simplicity
6. Scalability
7. Testability
8. Clear module ownership

The system is expected to evolve for many years.

Design decisions should optimize for long-term sustainability rather than short-term development speed.

---

# 4. Architecture Principles

## 4.1 Modular Monolith

The platform is implemented as a Modular Monolith.

Modules are independently organized but deployed as one application.

Each module owns its business logic.

Each module exposes explicit interfaces.

Modules must never access another module's internals.

---

## 4.2 Domain Driven Design

Business domains define software boundaries.

Examples:

Platform

Construction

Retail

Manufacturing

Logistics

Future modules must align with business domains.

---

## 4.3 Clean Architecture

Dependencies always point **inward toward the Domain**. The arrows below show
the direction of dependency — outer layers depend on inner layers, never the reverse.

```
                   ┌─────────────────────────────────┐
                   │             Domain               │
                   │  (entities, value objects,       │
                   │   domain events, port interfaces) │
                   └──────────────┬──────────────────┘
                                  ▲
                   ┌──────────────┴──────────────────┐
                   │          Application             │
                   │  (use cases, application         │
                   │   services, transactions)        │
                   └──────────────┬──────────────────┘
                                  ▲
           ┌──────────────────────┴──────────────────────┐
           │                                             │
  ┌────────┴────────┐                       ┌────────────┴────────┐
  │  Presentation   │                       │   Infrastructure    │
  │  (controllers,  │                       │   (Prisma, HTTP     │
  │   DTOs, guards) │                       │    clients, queues) │
  └─────────────────┘                       └─────────────────────┘
```

Domain must not import from NestJS, Prisma, PostgreSQL clients, HTTP types, queues,
or storage SDKs. Infrastructure implements interfaces (ports) defined by the Domain.

Business rules never depend on frameworks.

---

## 4.4 API First

Every capability is exposed through well-defined APIs.

Frontend communicates only through APIs.

No direct database access from frontend.

---

## 4.5 Convention over Configuration

The project follows consistent conventions.

Folder structure

Naming

Validation

Error handling

Logging

Testing

Documentation

All engineers follow the same conventions.

---

# 5. High Level Architecture

                    Users
                       │
                       ▼
              Next.js Frontend
                       │
                  REST API
                       │
               NestJS Backend
                       │
         ┌─────────────┼─────────────┐
         │             │             │
     Platform     Business      Infrastructure
      Modules      Modules          Services
         │             │             │
         └─────────────┼─────────────┘
                       │
                  PostgreSQL

6. Technology Stack
Frontend
Next.js
React
TypeScript
Tailwind CSS
shadcn/ui
TanStack Query
React Hook Form
Zod
Backend
NestJS
TypeScript
Prisma ORM
Database
PostgreSQL
Authentication
JWT
Refresh Tokens
RBAC
Infrastructure
Docker
GitHub Actions

Future

Object Storage
Redis
Queue
Monitoring
7. Layered Architecture

Every module follows the same internal structure.


Module
│
├── presentation
│
├── application
│
├── domain
│
└── infrastructure

Presentation

Responsibilities

Controllers
DTOs
Validation
HTTP

Never contains business logic.

Application

Responsibilities

Use Cases
Application Services
Transactions
Coordination
Domain

Responsibilities

Business Rules
Entities
Value Objects
Domain Events
Interfaces

Framework independent.

Infrastructure

Responsibilities

Prisma
External APIs
File Storage
Email
Queue
Database
8. Core Platform Modules

Platform modules are shared across the ERP.

These include:

Authentication

Authorization

Users

Organizations

Roles

Permissions

Audit Logs

Settings

Notifications

Files

Every business module depends on these.

Platform modules never depend on business modules.

### Sprint 2 Platform Modules — Implemented

| Module | Status | Key deliverables |
|---|---|---|
| Auth (Phase 1) | ✅ Complete | HttpOnly refresh cookie, jti rotation, token-family reuse detection |
| Tenancy (Phase 2) | ✅ Complete | TenantContext / RequestIdentity split, LRU client cache (max 50), onApplicationShutdown |
| OrganizationMembership (Phase 2) | ✅ Complete | JWT guard validates active membership on every request |
| WorkflowTriggerResolver (Phase 2) | ✅ Complete | 4-step DOCUMENT + STATE_TRANSITION resolution; bindings seeded (inactive) |

9. Business Modules

Current modules

Construction

Retail (stub)

Manufacturing (stub)

Future

Logistics

Commercial Real Estate

Construction Consulting

Each module owns:

Business Rules

Entities

Application Services

Reports

Permissions

API

Database Tables

### Sprint 2 Business Modules — Implemented

| Module | Status | Key deliverables |
|---|---|---|
| Projects (Phase 3) | ✅ Complete | Full lifecycle (8 states), suspend/resume, project membership |
| BOQ (Phase 4) | ✅ Complete | Versioning (DRAFT→BASELINED→SUPERSEDED), materialized-path tree, move via raw SQL |

### Sprint 3 Platform Additions — Implemented

| Module | Status | Key deliverables |
|---|---|---|
| Clients | ✅ Complete | Client aggregate, contacts, WorkflowRequirementPolicy |
| BOQ node extensions | ✅ Complete | measurementMethod, pricingBasis, isLeaf flag |
| Project commercial model | ✅ Complete | commercialModel, participationModel |

### Sprint 3 Business Modules — Implemented

| Module | Status | Key deliverables |
|---|---|---|
| Contracts | ✅ Complete | Full lifecycle (8 states), client snapshots on execute, retention terms, advance terms, guarantees, milestones, cross-aggregate trigger (PRACTICAL_COMPLETION → FINAL_ACCOUNT_PENDING) |
| IPA | ✅ Complete | Interim Payment Applications — 6 states, auto applicationNumber, previousEffectiveCertified resolution, BOQ item + deduction management |
| IPC | ✅ Complete | Interim Payment Certificates — isEffective partial unique index, varianceReason enforcement, atomic supersession |
| Finance | ✅ Complete | PaymentReceipt + ReceiptAllocation — payment status derived (UNPAID/PARTIALLY_PAID/PAID), allocation guard |

> **Sprint 3 Finance is construction billing tracking only — NOT full accounting.**
> Full accounting (GL, AP, AR, journal entries, trial balance, financial statements) begins in Sprint 4.
> See `docs/02-architecture/roadmap.md` for the 9-sprint plan.

### Sprint 3 Architecture Decisions

- ADR-003: Client aggregate
- ADR-004: Sprint 2 corrections (already recorded)
- ADR-005: Sprint 3 — Contracts, IPA, IPC, PaymentReceipt
- ADR-006: Sprint 4 — Native Accounting Foundation (ACCEPTED)

---

### Sprint 4 Platform Additions — Implemented

| Module | Status | Key deliverables |
|---|---|---|
| AuditLogs transactional outbox | ✅ Complete | `TransactionalAuditOutboxService` — writes `AuditLog` + `AuditOutboxEvent` in same DB transaction as the business mutation (ADR-008) |

### Sprint 4 Business Modules — Implemented

| Module | Status | Key deliverables |
|---|---|---|
| AccountingCore | ✅ Complete | Chart of Accounts (account versions, control accounts), FiscalYear + AccountingPeriod (OPEN/LOCKED/CLOSED), double-entry posting engine (`AccountingPostingService`), `DocumentSequenceRepository`, `JournalRepository`, `AccountRepository` |
| ManualJournals | ✅ Complete | DRAFT → SUBMITTED → APPROVED → POSTED → REVERSED lifecycle, CFO four-eyes rule |
| AccountsReceivable | ✅ Complete | `ClientInvoiceService` (from IPC), `CustomerReceiptService` (post + allocate), reversal chain (EVT-AR-001/003/005/006) |
| AccountsPayable | ✅ Complete | `SupplierBillService` (create/submit/approve/post/reverse), `SupplierPaymentService` (post/advance allocation/reverse), NON_RECOVERABLE VAT (EVT-AP-001/003/005/006) |
| GeneralLedger | ✅ Complete | `LedgerService` (running balance), `TrialBalanceService`, `PLReportService`, `BalanceSheetService`, `PeriodManagementService` (lock/close/reopen/snapshot/year-end) |
| OpeningBalance | ✅ Complete | Migration wizard — trial balance import, open AR invoices, open AP bills |

**Sprint 4 verification:** 87 integration tests passing across all accounting invariants
(∑ Dr = ∑ Cr, trial balance closes, Balance Sheet equation, CLOSING entries excluded from P&L,
closed periods use PeriodAccountBalance snapshots, cross-tenant blocked).

### Sprint 4 Architecture Decisions

- ADR-006: Native Accounting Foundation (ACCEPTED, FULLY LOCKED — 22 decisions)
- ADR-008: Effective-Dated Governance and Transactional Audit Outbox (ACCEPTED)
- Companion: `accounting-event-catalog.md` — v1.2, full posting event catalog

### Module File Map (Sprint 4)

```
apps/api/src/
├── platform/
│   └── audit-logs/           — TransactionalAuditOutboxService, AuditLog/AuditOutboxEvent
│
└── business/
    └── accounting/
        ├── accounting-core/  — AccountingPostingService, AccountRepository,
        │                       JournalRepository, DocumentSequenceRepository,
        │                       PeriodValidator, DoubleEntryValidator, ControlAccountValidator
        ├── manual-journals/  — ManualJournalService (4 endpoints)
        ├── accounts-receivable/ — ClientInvoiceService, CustomerReceiptService (8 endpoints)
        ├── accounts-payable/ — SupplierBillService, SupplierPaymentService,
        │                       SupplierService (16 endpoints)
        └── general-ledger/   — LedgerService, TrialBalanceService, PLReportService,
                                BalanceSheetService, PeriodManagementService (12 endpoints)
```

---

### Sprint 5 Platform Additions — Implemented

| Module | Status | Key deliverables |
|---|---|---|
| Workflows — CommandGovernanceService | ✅ Complete | Single seam hiding `WorkflowTriggerResolverService` + `ApprovalInstance` creation. `gateStateTransition()` returns `null` (proceed) or `{ gated: true, approvalInstanceId }` (block). `throwIfGated()` helper throws 409 with instance ID. `GovernedEntity` type in `@erp/types` enforces typed entity names at the call site. |

### Sprint 5 Business Modules — Implemented

| Module | Status | Key deliverables |
|---|---|---|
| Catalogue | ✅ Complete | `UnitOfMeasure` (org-configurable), `MaterialCategory` (hierarchical, operational), `SpendCategory` (hierarchical, financial governance), `Material` catalogue |
| MaterialRequests | ✅ Complete | Dual-scope (PROJECT \| ORGANIZATION), multi-line, BOQ-linked optional, DOA approval, `TransactionalAuditOutboxService` wired |
| PurchaseOrders | ✅ Complete | Immutable revision model (`PurchaseOrder` + `PurchaseOrderRevision` + `PurchaseOrderLine`), MR↔PO many-to-many allocation (`PurchaseOrderLineRequestAllocation`), DOA conditional routing, `TransactionalAuditOutboxService` wired |
| GoodsReceipts | ✅ Complete | `GoodsReceiptNote` + `GoodsReceiptLine` (received/accepted/rejected), `GoodsReceiptLineAllocation` (per-project attribution from PO ratios), over-receipt tolerance (`OverReceiptPolicy`), `EXCEPTION_PENDING` above tolerance, `TransactionalAuditOutboxService` wired |
| BillMatching | ✅ Complete | `SupplierBillMatch` + `SupplierBillMatchLine` explicit audit result, `MatchingTolerancePolicy` (hierarchical: PO → SpendCategory → Org), THREE_WAY for MATERIAL / TWO_WAY for SERVICE, posting blocked unless MATCHED / MATCHED_WITH_TOLERANCE / APPROVED_EXCEPTION |
| CommitmentLedger | ✅ Complete | Immutable signed `CommitmentLedgerEntry`: COMMITTED (PO approval) → ACCRUED (GRN post) → ACTUAL (Bill post). `CommitmentLedgerWriter` service provides `committed()`, `accrued()`, `actual()` methods — auto-computes `reportingAmount`, sets `occurredAt`, eliminates duplicated struct across 3 services |

### Sprint 5 Architecture Decisions

- ADR-007: Sprint 5 Procurement, AP Integration, and Commitment Control (ACCEPTED — 13 locked decisions)
- ADR-009: Collapse Project-Access Scope Resolution into `ProjectAccessService` (ACCEPTED — internal refactor)
- Post-Sprint 5 architecture review: 5 candidates resolved (see `roadmap.md` for detail)

### Module File Map (Sprint 5)

```
apps/api/src/
├── platform/
│   └── workflows/
│       ├── application/
│       │   ├── command-governance.service.ts   — gateStateTransition(), throwIfGated()
│       │   └── workflow-trigger-resolver.service.ts
│       └── infrastructure/
│           └── workflows-prisma.repository.ts
│
└── business/
    └── procurement/
        ├── catalogue/          — UomRepository, MaterialRepository,
        │                         MaterialCategoryRepository, SpendCategoryRepository
        │                         (8 endpoints)
        ├── material-requests/  — MaterialRequestService (7 endpoints)
        ├── purchase-orders/    — PurchaseOrderService (6 endpoints)
        ├── goods-receipts/     — GoodsReceiptService (5 endpoints)
        ├── bill-matching/      — BillMatchingService (3 endpoints)
        └── commitment-ledger/
            ├── application/
            │   ├── commitment-ledger.service.ts  — query/reporting service
            │   └── commitment-ledger-writer.service.ts  — committed/accrued/actual writes
            └── infrastructure/
                └── commitment-ledger.repository.ts
```

### Module File Map (Sprint 2)

```
apps/api/src/
├── platform/
│   ├── auth/           — login, refresh (cookie), logout, JWT strategy
│   ├── tenancy/        — TenancyMiddleware, TenancyService (LRU), TenantContext
│   ├── project-access/ — cross-module project membership authorization policy
│   ├── users/          — GET /users/:id
│   ├── organizations/  — GET /organizations/:id
│   ├── roles/          — GET /roles (by org)
│   ├── permissions/    — GET /permissions
│   ├── audit-logs/     — GET /audit-logs
│   └── workflows/      — WorkflowsService, ApprovalService, WorkflowTriggerResolverService
│
└── business/
    └── construction/
        ├── projects/   — 16 endpoints: CRUD + lifecycle + suspend/resume + members
        └── boq/        — 11 endpoints: initialize, versioning, tree CRUD + move
```

### Module File Map (Sprint 3)

```
apps/api/src/
├── platform/
│   └── clients/        — 6 endpoints: CRUD + contacts
│
└── business/
    ├── construction/
    │   ├── contracts/  — 13 endpoints: lifecycle + retention + advance terms + guarantees + milestones
    │   ├── ipa/        — 12 endpoints: lifecycle + items + deductions
    │   └── ipc/        — 4 endpoints: issue + get + supersede
    └── finance/
        └── (receipts)  — 6 endpoints: receipts + allocations + payment status
```

10. Dependency Rules

Allowed

Frontend

↓

API

↓

Application

↓

Domain

↓

Infrastructure

Forbidden

Frontend → Database

Controller → Prisma

Controller → External Services

Module A → Module B Internal Classes

Circular Dependencies

Shared Database Access

11. Data Ownership

Every module owns its data.

Construction owns Construction tables.

Retail owns Retail tables.

Manufacturing owns Manufacturing tables.

Cross-module communication occurs through public interfaces.

Never through direct database manipulation.

12. Security

Every request passes through

Authentication

↓

Authorization

↓

Validation

↓

Business Logic

↓

Audit Logging

↓

Response

Every sensitive operation is auditable.

13. Error Handling

The platform follows one unified error strategy.

Validation Errors

Authentication Errors

Authorization Errors

Business Errors

Infrastructure Errors

Unexpected Errors

Every error returns a standard response format.

14. Logging

The platform records:

Authentication

Authorization failures

Business events

Errors

Warnings

System events

Sensitive data is never logged.

15. Auditing

Business transactions require audit trails.

Examples

Project Created

Purchase Approved

Invoice Posted

Role Changed

Permission Updated

Audit logs are immutable.

16. Scalability Strategy

Phase 1

Single Modular Monolith

↓

Phase 2

Background Jobs

↓

Phase 3

Caching

↓

Phase 4

Independent Services (only when justified)

Microservices are not a current goal.

17. Architecture Decision Records

Every architectural change requires an ADR.

Examples

Database changes

Authentication changes

Module boundaries

Technology replacement

Infrastructure changes

18. Non Goals

The platform will NOT:

Adopt microservices prematurely.

Optimize for theoretical scale.

Duplicate business logic.

Introduce unnecessary dependencies.

Bypass architecture principles.

19. Success Criteria

The architecture is successful if:

New engineers understand it quickly.

Modules remain independent.

Business logic remains isolated.

Development is predictable.

Testing is straightforward.

Deployment is reliable.

Future modules integrate without major redesign.

20. Future Evolution

The architecture is intentionally designed for long-term growth.

As the company expands, additional business domains can be introduced without restructuring the platform.

The guiding principle is:

"Extend the platform by adding modules, not by rewriting the foundation."


---

## Before we continue

I want to make **one architectural change** before we write any more documents.

You originally proposed:

> NestJS + PostgreSQL + Next.js

I recommend we formalize this as a **Turborepo monorepo** from day one.


apps/
api/ (NestJS)
web/ (Next.js)

packages/
ui/
config/
types/
eslint/
tsconfig/


For a 2–3 engineer team, this provides:

- Shared TypeScript configuration
- Shared UI components
- Shared types
- Shared linting and formatting
- Consistent dependency management
- Easier CI/CD

It keeps one repository while avoiding duplication, and it scales well as you add more ap
