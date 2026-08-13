# Phase 6 - Release Hardening

Status: Implemented; authenticated browser execution requires local credentials.

## Scope

Phase 6 closes release-quality gaps without adding new domain capabilities:

- zero-warning typed lint gates;
- deterministic real-API browser scenarios;
- client-to-project creation coverage;
- project-to-IPA creation coverage;
- IPC issue and supersession coverage;
- desktop and 375px overflow/touch-target coverage;
- English/Arabic direction coverage;
- light/dark persistence and keyboard skip-link coverage;
- complete API and web production builds.

## E2E Architecture

`apps/web/tools/seed-scenario.mjs` creates two independent submitted applications:

1. a certified and paid application used for immutable billing reconciliation tests;
2. an uncertified application reserved for issue and supersession browser tests.

This separation makes the suite order-independent. Mutating release workflows run only in
the desktop project, while responsive assertions run in both desktop and mobile projects.
The suite never embeds credentials; `RUKNA_DEMO_PASSWORD` is required at runtime.

The scenario descriptor is loaded lazily from `e2e/.scenario.json`. Test discovery therefore
works on a clean checkout before global setup has created the file.

## Commands

```powershell
$env:RUKNA_DEMO_PASSWORD='<local demo password>'
pnpm --filter @erp/api dev
pnpm --filter @erp/web test:e2e
```

The Playwright configuration starts or reuses the web server. The API and tenant PostgreSQL
databases must already be available.

## Completed Gates

- E2E discovery: 58 desktop/mobile cases across three files.
- API lint: zero warnings and zero errors.
- Web lint: zero warnings and zero errors.
- Monorepo production build: passed for API and web.

## Environment-dependent Gate

Authenticated E2E execution and screenshot capture are not valid without the authorized
local password. A startup probe with an intentionally invalid password verified that the
harness loads correctly and reaches the API transport; it stopped because the API was not
running. No credential was stored in the repository or command history.
