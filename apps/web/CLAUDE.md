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

## Sprint 2 Backend Status — What Is Live Right Now

The following endpoints are **fully implemented and working**. Build UI against these.

### Auth
```
POST /api/v1/auth/login          — body: { email, password } → { accessToken } + HttpOnly cookie
POST /api/v1/auth/refresh        — no body (uses cookie) → { accessToken }
POST /api/v1/auth/logout         — no body → clears cookie
```

### Platform
```
GET  /api/v1/users/:id
GET  /api/v1/organizations/:id
GET  /api/v1/roles
GET  /api/v1/permissions
GET  /api/v1/audit-logs
GET  /api/v1/workflows/definition/:transactionType
GET  /api/v1/workflows/instance/:id/step
POST /api/v1/workflows/instance/:id/approve
POST /api/v1/workflows/instance/:id/reject
```

### Projects (full lifecycle)
```
GET    /api/v1/projects                        — list (filter: ?status=ACTIVE)
POST   /api/v1/projects                        — create DRAFT
GET    /api/v1/projects/:id                    — get with members + suspension
PATCH  /api/v1/projects/:id                    — update (DRAFT only)
POST   /api/v1/projects/:id/approve            — DRAFT → APPROVED
POST   /api/v1/projects/:id/mobilize           — APPROVED → MOBILIZING
POST   /api/v1/projects/:id/activate           — MOBILIZING → ACTIVE
POST   /api/v1/projects/:id/practical-completion — ACTIVE → PRACTICAL_COMPLETION
POST   /api/v1/projects/:id/closeout           — PRACTICAL_COMPLETION → CLOSEOUT
POST   /api/v1/projects/:id/close              — CLOSEOUT → CLOSED
POST   /api/v1/projects/:id/cancel             — body: { reason }
POST   /api/v1/projects/:id/suspend            — body: { reason }
POST   /api/v1/projects/:id/resume
GET    /api/v1/projects/:id/members
POST   /api/v1/projects/:id/members            — body: { userId, roles[] }
DELETE /api/v1/projects/:id/members/:userId
```

### BOQ (Bill of Quantities)
```
POST   /api/v1/projects/:id/boq                            — initialize (idempotent)
GET    /api/v1/projects/:id/boq                            — get + version list
POST   /api/v1/projects/:id/boq/draft                      — new draft from approved
POST   /api/v1/projects/:id/boq/versions/:vId/baseline     — lock draft as approved
POST   /api/v1/projects/:id/boq/versions/:vId/cancel       — cancel draft
GET    /api/v1/projects/:id/boq/versions/:vId/tree         — full recursive tree
POST   /api/v1/projects/:id/boq/versions/:vId/nodes        — add node
PATCH  /api/v1/projects/:id/boq/versions/:vId/nodes/:nId   — update node
POST   /api/v1/projects/:id/boq/versions/:vId/nodes/:nId/move  — move node + descendants
DELETE /api/v1/projects/:id/boq/versions/:vId/nodes/:nId   — delete leaf node
```

---

## What Is NOT Built Yet — Do Not Mock or Stub

The API does not have these endpoints. Do not build UI for them yet.

- Contracts, Milestones
- Subcontracts, Subcontract Certificates
- IPC (Interim Payment Certificates)
- Material Requests, Purchase Orders, GRNs
- Stock Ledger, Stock Transfers
- Cost Ledger, Cost Reporting
- Daily Progress Reports, Measurement Sheets
- Labour & Equipment Logs
- File Uploads / Attachments
- Notifications / Alerts
- Settings pages (org config, DOA thresholds)

---

## Auth Implementation Rules

1. **Never store tokens in `localStorage`** — XSS risk. Keep `accessToken` in memory only (Zustand or React context).
2. **Never touch the `refreshToken` cookie** — it is `HttpOnly`. The browser manages it automatically.
3. **Always set `credentials: 'include'`** on fetch / `withCredentials: true` on axios.
4. **Refresh flow**: on `401`, call `POST /auth/refresh` once. If that also returns `401`, clear the token and redirect to `/login`.
5. Access tokens expire in **15 minutes**. Build an interceptor that handles refresh automatically.

```typescript
// Recommended axios interceptor pattern
axios.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      try {
        const { data } = await axios.post('/api/v1/auth/refresh');
        setAccessToken(data.accessToken); // save to memory store
        error.config.headers.Authorization = `Bearer ${data.accessToken}`;
        return axios(error.config);
      } catch {
        clearAccessToken();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
```

---

## Shared Types

Import from the monorepo package — **do not redefine locally**:

```typescript
import type { RequestIdentity, LoginResponse } from '@erp/types';
import { ProjectStatus, ProjectRole, BoqVersionStatus, WorkflowTransactionType } from '@erp/types';
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

- `400` → show `error.message` as form or toast error
- `401` → trigger refresh flow → redirect to login
- `403` → show "Access denied" message
- `404` → show not-found state
- `409` → show conflict message (e.g., "Project code already exists")

---

## If You Are Unsure About a Business Rule

Ask before guessing. Construction ERP errors (wrong retention calculation, wrong IPC amount,
wrong approval chain) cost real money for real people.

- Technical / API question → Abdulsalam (backend engineer)
- Business / domain question → Eng Ahmed Shirie (CEO, ACCO Ltd)
