# @erp/web

The Rukna ERP frontend — Next.js App Router, TanStack Query, Tailwind, `next-intl`
(English + Arabic/RTL).

Start with [`CLAUDE.md`](./CLAUDE.md) for the rules this app is built under, and
[`docs/reference/api-reference.md`](../../docs/reference/api-reference.md) for
the API it consumes.

---

## Running locally

The app is multi-tenant by **subdomain**, so the host matters. Develop against
`http://acco.localhost:3000` — never `http://localhost:3000`, which carries no tenant and
gets `404 Tenant not found` from the API.

```bash
docker compose up -d                     # Postgres on :5435
pnpm --filter @erp/api dev               # API on :3001
pnpm --filter @erp/web dev               # this app on :3000
```

Then open <http://acco.localhost:3000>.

### First run, or after pulling backend changes

Three build artefacts are gitignored and go stale silently. Each fails in a way that does
not name the real cause, so they are worth doing up front:

```bash
pnpm --filter @erp/types build                    # else: "@erp/types has no exported member ..."
pnpm --filter @erp/api db:generate                # else: "Property 'client' does not exist on type 'PrismaClient'"
pnpm --filter @erp/api exec prisma migrate deploy --schema=prisma/schema.prisma
                                                  # else: 500, "table public.clients does not exist"
```

The last one migrates the **tenant** database (`rukna_acco`). Tenant migrations are not
applied by starting the API, so a tenant provisioned before a sprint landed will be missing
that sprint's tables.

---

## Seeding a billing scenario

```bash
pnpm --filter @erp/web seed
```

Builds a complete chain over the public API — client → project → baselined BOQ → active
contract with retention and advance terms → payment application → certificate → allocated
receipt — and prints the ids and figures.

Every run creates a fresh scenario with a unique suffix, so it is safe to run repeatedly.
The script is frontend-owned and touches nothing under `apps/api/**`: it calls the same
endpoints the browser calls, which means it fails loudly whenever the API contract moves.

Options: `--api <url>`, `--email`, `--password`.

> The script connects over `node:http` rather than `fetch`, on purpose. Windows does not
> resolve `*.localhost` subdomains for Node, and `Host` is a forbidden header in undici — so
> `fetch` can reach neither `acco.localhost` nor a Host-spoofed loopback. See the comment at
> the top of `tools/seed-scenario.mjs`.

---

## Checks

```bash
pnpm --filter @erp/web type-check
pnpm --filter @erp/web lint
pnpm --filter @erp/web test
```

Every screen is expected to pass in **both** locales and at a **375px** viewport before it
is called done.

---

## Layout

```
src/app/          routes (App Router; (auth) and (app) groups)
src/features/     one folder per domain area — api/, components/, hooks/, pure modules
src/components/   cross-feature UI (app shell, dialogs)
src/lib/          api client, tenant resolution, formatting, api-types.ts
messages/         en/ and ar/ translations
tools/            developer scripts (not shipped)
```

Business rules live in **pure modules** next to their feature (`project-actions.ts`,
`subtree-currency.ts`, `node-form.ts`) so they can be tested without rendering anything.
Components stay thin around them.

`src/lib/api-types.ts` holds every wire shape the API returns. It is a deliberate mirror of
a backend-owned contract — see the header comment before adding to it.
