# Engineering Constraints
## Enterprise ERP Platform

Version: 1.0.0

Status: Active

Owner: Engineering Team

---

# 1. Purpose

This document defines the mandatory engineering constraints for the Enterprise ERP Platform.

Its purpose is to ensure that every engineer builds software using the same architectural principles, implementation standards, and quality expectations.

These constraints are mandatory.

Any deviation requires explicit team discussion and an approved Architecture Decision Record (ADR).

---

# 2. Engineering Philosophy

The platform is designed as a long-term enterprise product.

Every engineering decision must optimize for:

- Maintainability
- Correctness
- Simplicity
- Security
- Scalability
- Testability
- Readability

Never optimize for short-term development speed at the expense of long-term system quality.

---

# 3. Architecture Constraints

The following architectural constraints are mandatory.

## 3.1 Modular Monolith

The platform is implemented as a Modular Monolith.

Microservices are explicitly out of scope.

---

## 3.2 Domain Driven Design

Software modules follow business domains.

Examples:

- Platform
- Construction
- Retail
- Manufacturing
- Logistics

Modules are business boundaries, not technical folders.

---

## 3.3 Clean Architecture

Dependencies always point inward.

Presentation

↓

Application

↓

Domain

↓

Infrastructure

Business rules must never depend on frameworks.

---

## 3.4 Feature First

All code is organized by feature/module.

Never organize code by file type across the whole application.

Correct

Construction/

Retail/

Platform/

Wrong

controllers/

services/

repositories/

---

## 3.5 Single Responsibility

Every class should have one clear responsibility.

Avoid "God Services".

---

## 3.6 Explicit Dependencies

Hidden dependencies are prohibited.

All dependencies must be constructor injected.

---

# 4. Module Constraints

Every module owns:

- Business rules
- Database schema
- Application services
- API
- Permissions
- Reports

Modules communicate only through public interfaces.

Accessing another module's internal implementation is prohibited.

---

# 5. Backend Constraints

Backend framework:

NestJS

Language:

TypeScript

Database access:

Prisma

Mandatory rules:

- Strict TypeScript enabled
- No business logic inside controllers
- Controllers only coordinate requests
- Validation before business logic
- Business rules belong in the Application/Domain layer
- Transactions for multi-step operations
- No duplicated business logic
- No raw SQL without documented justification
- Configuration loaded only through ConfigModule

---

# 6. Frontend Constraints

Framework:

Next.js

Mandatory rules:

- App Router
- TypeScript Strict Mode
- Server Components by default
- Client Components only when required
- Feature-based folder structure
- Shared UI components
- Shared design tokens
- Forms follow one standard
- No duplicate API calls

---

# 7. Database Constraints

Database:

PostgreSQL

ORM:

Prisma

Mandatory rules:

- UUID primary keys
- UTC timestamps
- Foreign key constraints
- Database migrations only through Prisma
- No manual schema changes
- No production hotfix SQL
- Naming conventions must be followed
- Soft delete policy documented
- Audit fields on transactional entities

---

# 8. API Constraints

REST API only.

Every endpoint must:

- Be authenticated unless explicitly public
- Validate request data
- Return documented status codes
- Follow API versioning
- Follow standard pagination
- Follow standard filtering
- Follow standard sorting

Response structures must remain consistent across modules.

---

# 9. Security Constraints

Security is mandatory.

Required:

JWT Authentication

Refresh Tokens

RBAC

Permission Checks

Password Hashing

Audit Logging

Environment Validation

Secret Management

Forbidden:

Plain text passwords

Hardcoded secrets

Disabled authorization

Skipping validation

Trusting client-side permissions

---

# 10. Authorization Constraints

Every protected endpoint must verify:

Authentication

↓

Role

↓

Permission

↓

Business Rule

↓

Data Ownership

Authorization is enforced on the server.

Frontend authorization is only for user experience.

---

# 11. Logging Constraints

The system logs:

Authentication events

Authorization failures

Errors

Warnings

Business events

Performance metrics

Sensitive information must never be logged.

---

# 12. Audit Constraints

The following operations require audit logs:

Authentication

Role changes

Permission changes

Project creation

Project approval

Purchase approval

Invoice approval

Configuration changes

User management

Audit logs are immutable.

---

# 13. Error Handling Constraints

The platform exposes one unified error strategy.

Categories:

Validation

Authentication

Authorization

Business

Infrastructure

Unexpected

Raw framework exceptions must never reach clients.

---

# 14. Testing Constraints

Every business feature requires:

Unit Tests

Integration Tests (where appropriate)

Critical workflows must be tested before release.

Production bugs require regression tests.

---

# 15. Git Constraints

Git is mandatory.

Rules:

No direct commits to main

No force pushes

Pull Requests required

At least one reviewer

CI must pass before merge

Meaningful commit messages

Conventional Commits

---

# 16. Documentation Constraints

Every significant feature must include:

Architecture updates

API documentation

Business assumptions

Migration notes (if applicable)

Undocumented features are considered incomplete.

---

# 17. Dependency Constraints

Before adding a dependency, ask:

Is it actively maintained?

Does it solve a real problem?

Can existing tools solve it?

Is it secure?

Does it increase complexity?

Unnecessary dependencies are prohibited.

---

# 18. Performance Constraints

Optimize only after measurement.

Premature optimization is prohibited.

Every optimization must have measurable justification.

---

# 19. AI Development Constraints

AI-generated code must follow the same engineering standards as manually written code.

Generated code must:

Be reviewed

Be tested

Follow architecture

Follow naming conventions

Not bypass validation

Not introduce undocumented dependencies

Engineers remain responsible for all generated code.

---

# 20. Prohibited Practices

The following are prohibited:

Business logic inside controllers

Business logic inside React components

Circular dependencies

Shared mutable global state

Duplicated business logic

Copy-paste programming

Hardcoded configuration

Direct database access from frontend

Skipping authorization

Skipping validation

Ignoring architecture

Changing architecture without ADR

---

# 21. Architecture Decision Records

The following changes require an ADR:

Technology changes

Architecture changes

Database strategy

Authentication strategy

Deployment strategy

Major dependency additions

Module boundary changes

---

# 22. Definition of Done

A feature is complete only if:

✓ Business requirement implemented

✓ Validation added

✓ Authorization enforced

✓ Error handling completed

✓ Tests pass

✓ Documentation updated

✓ Code reviewed

✓ CI passes

✓ No architecture violations

---

# 23. Guiding Principle

Every engineer is expected to leave the codebase better than they found it.

When making engineering decisions:

Prefer clarity over cleverness.

Prefer consistency over personal preference.

Prefer maintainability over speed.

Prefer business correctness over technical elegance.

Build software that another engineer can confidently maintain five years from now.