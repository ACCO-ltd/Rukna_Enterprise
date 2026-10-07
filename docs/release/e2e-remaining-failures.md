# E2E suite — remaining failures (tracking)

Status: IN PROGRESS — suite wired into CI (`.github/workflows/e2e.yml`), not yet fully green.
Date: 2026-10-07
Related: [Construction v1 release gate](construction-v1-release-gate.md) item B1.

## Context

The Playwright E2E suite had **never run in CI** before 2026-10-07 — it was local/manual only. Its first CI run surfaced **39 failures**, almost all pre-existing rot (the app moved on: ADR-033 control heights, ADR-043 route redirects, #256 client redesign, `@erp/ui` Select→combobox, ADR-024 receipt→invoice settlement). Triaged and fixed down to the residual below. **Three genuine product bugs were fixed** in the process:

- `platform.roles.{systemRole,customRole,protected}` missing i18n keys (crashed admin screens).
- `<main id="main-content">` not focusable → skip link now moves focus (a11y).
- `/projects` 375px document overflow → list filters now shrink.

Fixes landed on branch `docs/construction-v1-release-gate` (commits `0e66f169`, `9f18eb5c`). **E2E must stay a non-required check until this list is clear.**

## How to finish (recommended)

These are best finished with a **local browser loop** (fast iterate) rather than 16-min CI rounds. The suite's `global-setup` hardcodes the standard `acco.localhost:3001` stack, so a local run needs either that stack up, or a small tweak to point the seed at a local tenant. Where a fix needs the rendered DOM, that's noted.

## Product decisions needed first

1. **32px icon buttons on list pages** (touch-target failures). The design token is 40px comfortable / 34px compact (ADR-033); the test floor is now 36px. Some list-page icon buttons render at **32px**. Decide: lower the floor / exempt them, or bump them to ≥36px? (Identify them in a browser first.)
2. **Documents content tests need seeded documents.** `project-documents-qa` content assertions (e.g. "summary band states the expiry threshold") need a project that *has* documents; the E2E scenario seeds none. Decide: seed a document in `seed-scenario.mjs`, or scope the content tests out of CI (keep the responsive/overflow one).
3. **`GET /workflows/definition/IPC` → 404** on the admin Workflows screen. Decide: real bug (screen shouldn't request a missing definition) or seed-data gap (seed an IPC workflow definition)?

## Remaining failures — per test

Legend: 🔎 needs live DOM · ⚖️ needs a product decision · ✍️ test rewrite · 🐛 likely app bug

### billing-chain.spec.ts (✍️ — the big one)
- **`:29` a client leads to its contract, application and payment** and **`:131` the receipt allocation matches what the certificate certified.** Both walk the retired `/contracts/:id…` routes (now redirect to the project commercial workspace, ADR-043) and assert the retired **receipt→certificate** settlement. Current model (ADR-024): the receipt settles a **ClientInvoice** — Allocated = `invoiceTotal` ($169,680 = certified gross × 1.05), and the allocation links to `/finance/accounting/invoices/:id` with an `INV-…` label, not an `IPC-…` one (confirmed in `receipt-allocations-panel.tsx`).
  - **Fix:** add `invoiceId` / `invoiceNumber` / `invoiceTotal` to the `Scenario` interface (`e2e/scenario.ts` + `e2e/global-setup.ts`; the seeder already returns `invoice` + `invoiceTotal`). Rewrite `:131` to assert `invoiceTotal` and an `INV-` link. Rewrite `:29`'s contract/certificate/receipt sections against the commercial workspace (the `Retention` tab there was retired — move or drop that sub-assertion) and the invoice settlement. **Scope the client link with `.first()`** (it legitimately appears twice, both correct hrefs).

### responsive.spec.ts — touch targets (🔎 ⚖️)
- **`:118` controls on /clients, /clients/new, /contracts, /receipts** — two empty-text controls at **32px** (icon buttons). Needs DOM to identify + product call #1.
- **`:128` certificate row full-height** and **`:134` controls on the certificate detail** — offenders are **breadcrumb/trail links at 16–20px** ("Projects", project name, client name, "Open application"). The `fixtures.ts` exemption (`nav[aria-label="Breadcrumb"], thead`) does **not** match the actual trail markup. **Fix:** find the real breadcrumb/ModuleTrail container selector and exempt it (these are wayfinding, not thumb targets). 🔎

### admin-workspace-qa.spec.ts
- **`:106` leaves one Administration row in the sidebar** — `aside a[href^="/admin"], nav a[href^="/admin"]` returns `[]` even at 1440. The docked sidebar's `/admin` link isn't matched by that locator. 🔎 Needs `global-sidebar.tsx` DOM inspection to fix the locator.
- **`:143` holds together at 1440 (light/dark)** — now fails on `GET /workflows/definition/IPC → 404` collected by `watchForFailures`. Product call #3 (real bug vs seed gap). 🐛/⚖️

### release-workflows.spec.ts (🔎 ✍️)
- **`:6` creates a client** — `getByLabel('Phone', { exact: true })` times out; the contact phone is a custom `PhoneInput`. **Fix:** target its input id (likely `#client-contact-phone`) or the component's actual input; confirm structure in `client-form.tsx`.
- **`:41` creates a payment application** — `getByLabel('Period from')` resolves to a **DatePicker `<button id="ipa-from">`**, not an input, so `.fill()` throws. **Fix:** interact with the DatePicker (click → pick a day), or add a typeable input affordance.
- **`:56` issues/supersedes certificates** — combobox `option` 'Certified' now matched exactly (fixed in `9f18eb5c`); re-verify the rest of the wizard flow (supersession controls, waitForURL now permissive).

## Already fixed (for reference)

RTL test deleted (English-only); touch-target floor 44→36 (ADR-033) + breadcrumb/thead exemption (partial — see `:128/:134`); admin 7th "Branding" tab; admin tab-row tests pinned to desktop; commercial-workspace repoint for the old contract-detail layout test; `.first()` heading waits on redirected two-h1 pages; documents `PROJECT` falls back to the seeded scenario; i18n keys; `<main>` focusable; `/projects` filter overflow; release-workflows client form labels + retired `/ipc` route + combobox + permissive post-create URL waits.
