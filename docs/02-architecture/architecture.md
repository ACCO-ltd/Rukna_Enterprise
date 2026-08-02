# Enterprise ERP Platform
## Software Architecture Document (SAD)

Version: 1.0.0

Status: Draft

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

9. Business Modules

Current modules

Construction

Retail

Manufacturing

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