# Frontend — AI Agent Rules
# apps/web/ — Construction ERP (Rukna Platform)

---

## STOP BEFORE YOU START

Read these documents **in order** before making any change or answering any question:

1. `/docs/02-architecture/api-reference.md` — **Every live endpoint, request/response shapes, auth flow, error format. Read this first.**
2. `/docs/02-architecture/domain-model.md` — Entity definitions, enums, business rules
3. `/docs/02-architecture/architecture.md` — Stack, module map, Clean Architecture rules
4. `/docs/02-architecture/tenancy.md` — Multi-tenancy (subdomain), TenantContext
5. `/AGENTS.md` — Engineering operating manual
6. `/docs/02-architecture/constraints.md` — Engineering constraints
7. `/docs/02-architecture/boundaries.md` — Team ownership

---

## ⚠️ BACKEND BOUNDARY WARNING ⚠️

The following paths are **NOT** owned by the frontend engineer.
Do **NOT** modify them. Do **NOT** instruct an AI agent to modify them.

```
apps/api/**
apps/api/prisma/schema.prisma
packages/types/src/**
docker-compose.yml
apps/api/.env
```

If you need a backend change (new endpoint, different response shape, schema addition):

1. STOP — do not implement it yourself
2. Create a GitHub issue describing what you need
3. Contact **Abdulsalam** (backend engineer) for review and implementation
4. Wait for the updated types in `packages/types/` before consuming them

If you have a question about construction domain logic (how an IPC works, what triggers a
retention release, approval chain rules):

Contact **Eng Ahmed Shirie** (CEO, ACCO Ltd) — he is the domain expert.

Implementing incorrect business logic is worse than waiting for clarification.

---

## What You Own

```
apps/web/src/**           ← Your primary workspace
packages/ui/src/**        ← Shared UI components (you own this)
```

---

## What Is Live Right Now

`/docs/02-architecture/api-reference.md` is the endpoint reference — every path, request
and response shape. Read it there rather than from a copy here.

This file used to carry its own endpoint listing. It drifted: it documented a
`?status=ACTIVE` filter on `GET /clients` that the controller does not accept, and a
frontend engineer built against it. Two sources of truth for the same contract means one
of them is wrong and nobody knows which.

For discrepancies between the reference and the running API, see
`/docs/backend-requests/frontend-blockers.md`.

---

## What Is NOT Built Yet — Do Not Mock or Stub

The API does not have these endpoints. Do not build UI for them yet.

- Subcontracts / Subcontract Certificates
- Material Requests / Purchase Orders / Goods Receipt Notes
- Stock Ledger / Stock Transfers
- Cost Ledger / Cost Reporting
- Daily Progress Reports / Measurement Sheets
- Labour Attendance / Equipment Logs
- File uploads / Attachment storage (DB tables exist, no file serving endpoint)
- Notifications / Expiry alerts
- Settings pages (org config, DOA thresholds, workflow builder)
- Budget Authorization (for INTERNAL_CAPITAL projects)

---

## Critical Business Rules the UI Must Enforce

| Rule | What to do in UI |
|---|---|
| IPA items map to **leaf** BOQ nodes only | Only show leaf nodes in the item picker — filter by `isLeaf: true` |
| `cumulativeClaimed` = total-to-date, not this period | Show the calculation: `period = cumulative − previousEffectiveCertified` |
| `varianceReason` required when certified ≠ claimed | Client-side validate before submitting IPC |
| One effective IPC per application | If `isEffective` cert exists, hide "Issue" and show "Supersede" instead |
| Contract `execute` freezes client details forever | Warn: "Client name and tax number will be permanently locked onto this contract" |
| `practical-completion` moves ACTIVE contracts → `FINAL_ACCOUNT_PENDING` | Confirmation dialog listing affected contracts |
| Receipt allocations cannot exceed receipt amount | Show remaining unallocated balance live in form |
| IPA is immutable after `SUBMITTED` | Hide all edit controls when `status === 'SUBMITTED'` |
| `422` response = workflow not configured | Show "Approval workflow not configured — contact your system administrator" |

---

## Auth Implementation Rules

1. **Never store tokens in `localStorage`** — XSS risk. Keep `accessToken` in memory only (Zustand or React context).
2. **Never touch the `refreshToken` cookie** — it is `HttpOnly`. The browser manages it automatically.
3. **Always set `credentials: 'include'`** on every request.
4. **Refresh flow**: on `401`, call `POST /auth/refresh` once. If that also returns `401`, clear the token and redirect to `/login`.
5. Access tokens expire in **15 minutes**. Refresh is handled automatically.

This is already implemented in `src/lib/api-client.ts` — use `apiClient`, do not write a
second one. It refreshes behind a single-flight guard, because the API rotates the refresh
token and treats a reused one as an attack: two concurrent refreshes would revoke the whole
token family and sign the user out everywhere.

---

## Shared Types

Import from the monorepo package — **do not redefine locally**:

```typescript
import type { RequestIdentity } from '@erp/types';
import {
  ProjectStatus, ProjectRole, CommercialModel, ParticipationModel,
  BoqVersionStatus, MeasurementMethod, PricingBasis,
  ClientStatus,
  ContractStatus, BillingModel, AdvanceType, GuaranteeStatus,
  IpaStatus, IpcStatus,
} from '@erp/types';
```

---

## Multi-Tenancy (Subdomain)

Every API request must go to `https://{slug}.rukna.app/api/v1`.

In Next.js, read the tenant slug from `headers().get('host')` in middleware and inject
it into all API client calls. During local development:
- Backend: `http://acco.localhost:3001/api/v1`
- Frontend: `http://acco.localhost:3000`

---

## Next.js Rules

- App Router only — no Pages Router
- Server Components by default
- `'use client'` only when state or browser APIs are needed
- No direct database access — all data through the API

---

## i18n Rules (MANDATORY)

The platform is bilingual: English + Arabic (RTL).

- Every user-visible string must use `next-intl` — no hardcoded English strings in JSX
- Arabic is right-to-left — components must not assume left-to-right layout
- Test every new screen in both `en` and `ar` modes before marking complete
- The HTML `dir` attribute must reflect the active language

---

## Mobile-Responsive Rules (MANDATORY)

Every screen must work on a 375px wide viewport.

- Design mobile-first — desktop layout is an enhancement
- Test all forms and tables on a narrow viewport before marking complete
- Touch targets must be at least 44×44px

---

## API Integration Rules

- All API calls go through `src/lib/api-client.ts` — no ad-hoc fetch in components
- Use TanStack Query for all server state — no `useEffect + useState` for data fetching
- Never cache sensitive financial data in localStorage or sessionStorage
- Auth tokens are managed by the auth module — do not handle them in feature components

---

## Styling Rules

- Tailwind CSS only — no inline styles, no CSS modules unless documented
- Use `packages/ui/` components before creating new ones
- Design tokens (colors, spacing) defined in the design system — do not hardcode hex values

---

## Error Handling

All API errors return:
```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }
```

| Status | Handle as |
|---|---|
| `400` | Show `error.message` as form or toast error |
| `401` | Trigger refresh flow → redirect to login |
| `403` | Show "Access denied" |
| `404` | Show not-found state |
| `409` | Show conflict message (e.g., "Contract number already exists") |
| `422` | Show "Approval workflow not configured — contact your system administrator" |

---

## If You Are Unsure About a Business Rule

Ask before guessing. Construction ERP errors (wrong retention calculation, wrong IPC amount,
wrong approval chain) cost real money for real people.

- Technical / API question → Abdulsalam (backend engineer)
- Business / domain question → Eng Ahmed Shirie (CEO, ACCO Ltd)
