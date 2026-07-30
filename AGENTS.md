# AGENTS.md

# Rukna — Enterprise ERP Platform
## Engineering Operating Manual

---

## What Is Rukna?

Rukna (Arabic: ركنة — pillar) is a multi-tenant, multi-vertical Enterprise ERP Platform
built to serve construction, retail, manufacturing, logistics, and real estate companies.

**First client:** ASAS CONSTRUCTION COMPANY (ACCO LTD) — Construction & Contracting module.
**Architecture:** C1 — shared NestJS API, one PostgreSQL database per tenant client.
**Stack:** Turborepo monorepo · NestJS (backend) · Next.js (frontend) · Prisma · PostgreSQL.
**Languages:** English + Arabic (RTL) from day one.
**Platform domain:** rukna.com (TBD) · Local dev: acco.localhost

Read `docs/02-architecture/tenancy.md` to understand how multi-tenancy works before
making any change that touches database queries, authentication, or the request pipeline.

---

Version: 1.0.0

Status: Active

---

# Purpose

This repository is the single source of truth for the Enterprise ERP Platform.

Every contributor—human or AI—is expected to follow the engineering standards defined in this repository.

The goal is consistency, maintainability, and long-term product quality.

This document defines **how contributors must work**, not how the software is implemented.

---

# Mission

Build a production-grade Enterprise ERP Platform that is:

- Maintainable
- Secure
- Modular
- Auditable
- Scalable
- Extensible
- Business Correct

The platform is intended to evolve over many years.

Every engineering decision should optimize for long-term maintainability rather than short-term development speed.

---

# Engineering Philosophy

We value:

- Business correctness over technical cleverness
- Simplicity over unnecessary complexity
- Consistency over personal preference
- Explicit design over hidden behavior
- Maintainability over speed
- Long-term architecture over quick fixes

When uncertain, choose the option that improves long-term maintainability.

---

# Repository Is The Source of Truth

Do not invent architecture.

Do not assume conventions.

Do not create new patterns.

Always follow the documented standards.

If documentation conflicts with a request, documentation takes precedence.

If documentation is unclear, stop and request clarification.

---

# Team

| Role | Name | Owns | Escalate to for |
|---|---|---|---|
| Backend Engineer | Abdulsalam | apps/api/, prisma/schema.prisma, packages/types/ | API contracts, schema changes, backend architecture |
| CEO / Domain Expert | Eng Ahmed Shirie | ACCO Ltd business processes | Construction domain rules, approval workflows, business logic |
| Frontend Engineer | (assigned) | apps/web/, packages/ui/ | UI/UX, component design, frontend state |

---

# Required Reading Order

Before making any change, contributors MUST read the following documents in order.

1. docs/02-architecture/architecture.md          ← overall architecture
2. docs/02-architecture/constraints.md           ← mandatory engineering rules
3. docs/02-architecture/tenancy.md               ← HOW MULTI-TENANCY WORKS (read this carefully)
4. docs/02-architecture/adr/ADR-001-platform-architecture.md   ← platform decisions
5. docs/02-architecture/adr/ADR-002-construction-domain.md     ← construction decisions
6. docs/02-architecture/adr/ADR-003-sprint1-foundation.md      ← sprint 1 decisions + rule IDs
7. docs/02-architecture/domain-model.md          ← entity map and glossary
8. docs/02-architecture/boundaries.md            ← who owns what
9. docs/02-architecture/sprint1-build-plan.md   ← exact build sequence (Sprint 1)
10. Module-specific CLAUDE.md (apps/api/CLAUDE.md or apps/web/CLAUDE.md)

Do not make changes without understanding the relevant documentation.

If you are an AI agent: the sprint1-build-plan.md tells you exactly what to build,
in what order, with what file paths. Follow it precisely.

---

# Standard Workflow

Every implementation follows the same workflow.

Developer Request

↓

Understand Requirement

↓

Read Documentation

↓

Identify Applicable Rules

↓

Validate Architecture

↓

Implement

↓

Self Review

↓

Update Documentation (if required)

↓

Submit Pull Request

Skipping steps is prohibited.

---

# Contributor Responsibilities

Every contributor must:

- Follow the documented architecture.
- Follow engineering constraints.
- Respect module boundaries.
- Maintain code quality.
- Keep documentation synchronized with implementation.
- Leave the codebase in a better state than it was found.

---

# Architecture Authority

Architecture decisions are defined only by:

- architecture.md
- Architecture Decision Records (ADR)

No contributor may introduce architectural changes without approval.

---

# Rule Enforcement

Every engineering document contains rule identifiers.

Example:

ARCH-001

CONST-004

BE-015

DB-008

API-012

When proposing code changes:

- Verify compliance with all applicable rules.
- Reference rule IDs when explaining decisions.
- Reject implementations that violate documented rules.

---

# Required Validation

Before writing code, verify:

✓ Correct module ownership

✓ Architecture compliance

✓ Dependency rules

✓ Database impact

✓ Security impact

✓ Permission requirements

✓ API consistency

✓ Documentation impact

✓ Testing requirements

---

# Required Before Merge

Every contribution must satisfy:

✓ Architecture compliant

✓ Constraints satisfied

✓ Code reviewed

✓ Validation implemented

✓ Authorization enforced

✓ Error handling implemented

✓ Tests passing

✓ Documentation updated

✓ CI passing

---

# Prohibited Actions

Do NOT:

- Change architecture without approval.
- Ignore documented constraints.
- Introduce undocumented patterns.
- Duplicate business logic.
- Bypass validation.
- Bypass authorization.
- Access databases directly from frontend.
- Hardcode secrets.
- Create circular dependencies.
- Add dependencies without justification.
- Ignore module ownership.
- Commit generated code without review.

---

# Documentation Policy

Documentation is part of the product.

Implementation and documentation must remain synchronized.

If implementation changes architecture, workflows, APIs, or engineering behavior, the corresponding documentation must be updated in the same change.

Undocumented architecture changes are not accepted.

---

# AI Contributor Policy

AI-generated code is held to the same engineering standards as manually written code.

Generated code must:

- Follow repository architecture.
- Respect documented constraints.
- Follow naming conventions.
- Maintain consistency.
- Avoid introducing unnecessary dependencies.
- Include appropriate validation.
- Preserve security requirements.

AI-generated code must never be accepted solely because it compiles.

---

# Architecture Conflicts

If a request conflicts with documented architecture:

STOP.

Do not implement the change.

Explain:

- Which rule is violated.
- Why it is violated.
- What compliant alternatives exist.

Never silently ignore architectural violations.

---

# Dependency Policy

Before adding any dependency, verify:

- Is it necessary?
- Is it actively maintained?
- Does an existing solution already exist?
- Does it increase complexity?
- Does it introduce security risks?

New dependencies require engineering approval.

---

# Security First

Every feature must consider:

Authentication

Authorization

Validation

Audit Logging

Error Handling

Sensitive Data Protection

Security is mandatory, not optional.

---

# Performance Philosophy

Do not optimize prematurely.

Measure first.

Optimize only when justified by evidence.

Maintain readability unless performance requirements demand otherwise.

---

# Definition of Done

A feature is complete only when:

- Business requirement implemented.
- Architecture respected.
- Constraints satisfied.
- Validation completed.
- Authorization enforced.
- Error handling completed.
- Logging added where appropriate.
- Tests written.
- Documentation updated.
- Pull Request approved.
- CI passes.

---

# Decision Hierarchy

When multiple sources exist, use this priority order:

1. Approved Architecture Decision Records (ADR)
2. architecture.md
3. constraints.md
4. Engineering documents
5. Module documentation
6. Developer request

Lower-priority sources must never override higher-priority sources.

---
# Conflict Resolution Policy

When a developer request conflicts with the repository documentation, the documented architecture and engineering rules take precedence.

Contributors must not violate documented standards to satisfy a request.

If a conflict is detected, follow this process:

1. Stop implementation.
2. Identify the applicable rule(s) by ID.
3. Explain why the request conflicts with the documented standard.
4. Suggest one or more compliant alternatives.
5. Resume implementation only after the conflict is resolved or the documentation is officially updated.

Valid outcomes are:

- APPROVED
- NEEDS CLARIFICATION
- REJECTED

Never silently ignore or bypass documented rules.

# Final Principle

The objective is not simply to produce working software.

The objective is to build an Enterprise ERP Platform that remains understandable, maintainable, and extensible for many years.

Every contribution should improve the platform rather than merely add functionality.

