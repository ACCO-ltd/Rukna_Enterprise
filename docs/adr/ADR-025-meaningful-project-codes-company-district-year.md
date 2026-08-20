# ADR-025 — Meaningful project codes (company · district · year · sequence)

- **Status:** accepted (Eng Ahmed, 2026-08-20)
- **Owner:** Abdulsalam (backend)
- **Supersedes:** the `PRJ-{year}-{seq}` project code scheme

## Context

Project codes were opaque (`PRJ-2026-0065`). Eng Ahmed asked for codes that a
construction firm's site and finance staff can read at a glance — the company
that built it, the district it sits in, and the year — so a code doubles as a
locator. Districts are not modelled today.

## Decision

### CONST-CODE-001 — Format

A project code is:

```
{ORG.shortCode}-{DISTRICT.code}-{YY}-{seq4}
```

e.g. **`ACCO-WBR-26-0065`** — the 65th project ACCO started in 2026, in Waaberi
(WBR) district.

- `ORG.shortCode` — a new per-tenant constant (`ACCO`), editable in org settings.
- `DISTRICT.code` — 3-letter district code from the district registry.
- `YY` — two-digit year.
- `seq4` — zero-padded running number.

### CONST-CODE-002 — Sequence scope

The counter is scoped **per (organization, year)** — the existing
`ProjectCodeSequence` scope, unchanged. `0065` counts **all** ACCO projects in
2026 across every district; it resets to `0001` in 2027. The district is a
**label** in the string, not part of the count. (Confirmed with Ahmed: "65
overall project that ACCO does in 2026".)

### CONST-CODE-003 — District is a project attribute, first-class reference data

- New **`District`** aggregate (org-scoped): `code` (immutable once used) + `name`
  (editable) + `active`. Districts are **configurable in Settings** — ACCO builds
  beyond Banaadir, so users add/rename/deactivate districts. Seeded with the 20
  Banaadir districts.
- `Project.districtId` is **required** for new projects.
- District belongs to the **project** (the site), never the client — one client
  can build in many districts, so client codes are untouched by this.

### CONST-CODE-004 — Allocation and immutability

The code is allocated **atomically on project create** (district picked first in
the form; the number is drawn inside the create transaction so abandoned drafts
leave no gap). `code` and `districtId` are **frozen after create**.

### CONST-CODE-005 — Existing projects

Current projects are dev/seed data → **re-seeded** with districts and new-format
codes. No legacy backfill; `districtId` is required from the first migration.

## Consequences

- Schema: add `Organization.shortCode`; add `District`; add `Project.districtId`
  (required, FK). Seed 20 Banaadir districts + `ACCO` shortCode.
- `allocateCode` rewritten to the new format; `ProjectCodeSequence` scope kept.
- New District CRUD (Settings) + org `shortCode` setting, both backend + UI.
- Project create form: district is a required step-1 field with a live code
  preview (`ACCO-WBR-26-####`); the real number appears on create.
- Client codes and the client aggregate are unaffected.
