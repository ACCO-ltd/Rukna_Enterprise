# ADR-001: Platform Architecture Decisions

Status: ACCEPTED
Date: 2026-07-30
Deciders: Abdulsalam (Backend Engineer), Eng Ahmed Shirie (CEO, ACCO Ltd)

---

## Context

The ERP platform is designed to serve multiple companies across multiple industries over many years. The first vertical is Construction & Contracting, with ASAS CONSTRUCTION COMPANY (ACCO LTD) as the first tenant. These decisions were reached through a structured discovery and grilling session based on ACCO's full business process document (July 2026).

---

## Decision 1 — Multi-Tenancy Model

**Chosen: C1 — Shared API, separate PostgreSQL database per tenant.**

One NestJS API handles all tenants. Each tenant has its own isolated PostgreSQL database. The API resolves the tenant from the request subdomain, looks up the tenant's database URL from a central registry, and connects per-request.

```
acco.yourplatform.com  →  [Shared NestJS API]  →  PostgreSQL: acco_db
acme.yourplatform.com  →  [Shared NestJS API]  →  PostgreSQL: acme_db
```

**Why:** Per-tenant databases give true data isolation. When a client requests their backup, it is one clean `pg_dump` command. Point-in-time restore affects only that tenant. A shared API means one codebase to maintain, update, and deploy.

**Constraint ARCH-MT-001:** Every API request must resolve tenant context before any database operation. Tenant resolution is via subdomain. The tenant registry is a separate lightweight database (not a tenant database).

**Constraint ARCH-MT-002:** No tenant may access another tenant's database under any circumstances. Cross-tenant queries are prohibited.

**Constraint ARCH-MT-003:** New tenant onboarding is performed via a CLI provisioning script (`pnpm tenant:provision`). The script creates the database, runs Prisma migrations, seeds default data (roles, permissions, workflow templates), and registers the tenant in the registry.

---

## Decision 2 — Client Access

**Chosen: Mobile-responsive web (PWA) now. Native mobile app in a later phase.**

The Next.js web application is built mobile-first and responsive from day one. It must work on phones used by site engineers and storekeepers on construction sites. A dedicated native mobile app (React Native or Flutter) will follow once core workflows are stable.

**Why:** Deploying the web platform to ACCO faster is the priority. Field staff will adopt the system more readily when they already know the workflows.

**Constraint ARCH-ACCESS-001:** Every UI screen must be fully usable on a 375px wide mobile viewport. Desktop-only layouts are rejected.

---

## Decision 3 — Language Support

**Chosen: English + Arabic (RTL) from day one.**

The platform ships bilingual. Arabic is right-to-left. The UI layout must flip correctly in Arabic mode. Users toggle language via a preference setting.

**Why:** ACCO operates in Somalia where Arabic is the language of business contracts, finance, and management. English is the technical standard. Retrofitting RTL after the fact is expensive.

**Constraint ARCH-I18N-001:** Use `next-intl` for all UI strings. No hardcoded English strings in components. Every string must have an `en` and `ar` translation key.

**Constraint ARCH-I18N-002:** The HTML `dir` attribute must respond to the active language. Arabic = `dir="rtl"`. Components must not assume left-to-right layout.

---

## Decision 4 — Currency

**Chosen: Multi-currency with manual exchange rates.**

Every financial amount in the system is stored with an `amount` (DECIMAL) and `currency_code` (VARCHAR 3, ISO 4217). Each organization defines a reporting currency. Exchange rates are entered manually by Finance and stored in an `ExchangeRate` table. Reports consolidate to the reporting currency using the applicable rate.

**Why:** ACCO contracts are priced in USD; local purchases and wages are paid in Somali Shilling (SOS). Storing amounts without currency creates conversion errors and loses the original record.

**Constraint ARCH-CCY-001:** No financial field may store an amount without an accompanying `currency_code`. Plain decimal-only money fields are rejected.

**Constraint ARCH-CCY-002:** Exchange rates are stored with a valid-from date. The system uses the rate effective on the transaction date.

---

## Decision 5 — Delegation of Authority (DOA) / Approval Engine

**Chosen: Configurable approval chains per transaction type, with pre-built templates.**

Each organization defines its own approval chains for each transaction type (Material Request, Purchase Order, Subcontract Certificate, IPC, etc.). Chains are stored as `WorkflowDefinition` records — steps, roles, and amount thresholds. ACCO's chains are the default template. Other clients configure their own.

**Why:** Every construction company has a different org chart and different approval limits. Hardcoding chains makes the platform unsellable to a second client.

**Constraint ARCH-DOA-001:** No financial transaction may proceed to the next stage without all required approvals at the current stage. Approval bypass is prohibited except for system administrators with a documented override reason.

**Constraint ARCH-DOA-002:** Every approval action (approve, reject, delegate, escalate) is written to the audit log with timestamp, approver identity, and reason.

**Constraint ARCH-DOA-003:** Amount thresholds in approval chains are stored in the organization's reporting currency and converted at runtime.

---

## Decision 6 — Infrastructure and Hosting

**Chosen: Cloud VPS (DigitalOcean or Hetzner) with Docker Compose and a tenant provisioning script.**

The platform runs on a cloud VPS. Docker Compose manages the NestJS API and PostgreSQL instances. New tenant databases are provisioned via a CLI script. A managed database add-on (DigitalOcean Managed PostgreSQL) is preferred for production to handle backups and failover.

**Why:** Simple, reliable, cost-effective for early customers (1–20 tenants). Scales by upgrading the server tier. AWS/GCP are premature at this stage.

**Constraint ARCH-INFRA-001:** Secrets (database URLs, JWT secrets, API keys) are stored as environment variables. Never hardcoded in source code or committed to the repository.

**Constraint ARCH-INFRA-002:** Each tenant database must have automated daily backups configured at the infrastructure level (not application level).

**Constraint ARCH-INFRA-003:** The provisioning script is the only approved method for creating new tenant databases. Manual database creation is prohibited in production.
