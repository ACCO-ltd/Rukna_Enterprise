# Frontend — AI Agent Rules
# apps/web/ — Frontend Engineer

---

## STOP BEFORE YOU START

Read these documents in order before making any change:

1. `/AGENTS.md` — Engineering operating manual
2. `/docs/02-architecture/architecture.md` — Architecture
3. `/docs/02-architecture/constraints.md` — Engineering constraints
4. `/docs/02-architecture/boundaries.md` — Team ownership and boundaries

---

## ⚠️ BACKEND BOUNDARY WARNING ⚠️

The following paths are NOT owned by the frontend engineer.
Do NOT modify them. Do NOT instruct an AI agent to modify them.

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

If you have a question about construction domain logic (how an IPC works, what triggers a retention release, approval chain rules):

Contact **Eng Ahmed Shirie** (CEO, ACCO Ltd) — he is the domain expert.

Implementing incorrect business logic is worse than waiting for clarification.

---

## What You Own

```
apps/web/src/**           ← Your primary workspace
packages/ui/src/**        ← Shared UI components (you own this)
```

---

## Next.js Rules

Read `node_modules/next/dist/docs/` before writing any routing or data-fetching code. This version may have breaking changes from your training data.

- App Router only — no Pages Router
- Server Components by default
- Client Components only when state or browser APIs are needed (`'use client'`)
- No direct database access — all data comes through the API at `apps/api/`

---

## i18n Rules (MANDATORY)

The platform is bilingual: English + Arabic (RTL).

- Every user-visible string must use `next-intl` — no hardcoded English strings in JSX
- Arabic is right-to-left — components must not assume left-to-right layout
- Test every new screen in both `en` and `ar` modes before marking complete
- The HTML `dir` attribute must reflect the active language

---

## Mobile-Responsive Rules (MANDATORY)

Every screen must work on a 375px wide viewport (mobile phone).

- Design mobile-first — desktop layout is an enhancement, not the baseline
- Test all forms and tables on a narrow viewport before marking complete
- Touch targets must be at least 44×44px

---

## API Integration Rules

- All API calls go through `src/lib/api-client.ts` — do not create ad-hoc fetch calls
- Use TanStack Query for all server state
- Never cache sensitive financial data in localStorage or sessionStorage
- Authentication tokens are managed by the auth module — do not handle them manually in feature components

---

## Styling Rules

- Tailwind CSS only — no inline styles, no CSS modules unless documented
- Use `packages/ui/` components before creating new ones
- Design tokens (colors, spacing) are defined in the design system — do not hardcode hex values

---

## If You Are Unsure About a Business Rule

Ask before guessing. Construction ERP errors (wrong retention calculation, wrong IPC amount, wrong approval chain) cost real money for real people.

- Technical question → Abdulsalam
- Business / domain question → Eng Ahmed Shirie (CEO, ACCO Ltd)
