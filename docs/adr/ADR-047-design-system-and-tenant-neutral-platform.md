# ADR-047 — Rukna design system, tenant-neutral platform, and the 2026-10-27 grill decisions

**Status:** Accepted. Abdulsalam (product owner and sole engineer) and Eng Ahmed answered the grill
questions on 2026-10-27. §1–§3 are built (2026-10-28); §4 records decisions for later steps.

## Context

The UI redesign review (2026-10-27) produced an approved design system: tables, colours, forms,
dialogs and foundations, with mockups reviewed screen by screen. Two rules came with it: follow the
system end to end, and remember that Rukna is multi-tenant, so no company name may be built into the
code. This ADR records the system and both rules, plus the answers to the grill questions that
shape the next build steps.

## 1. Tenant-neutral platform (built: Step 1a, 73d367b)

- No tenant's name, address or branding appears in the code, message catalogues, placeholders, DTO
  examples or Swagger tags. The login page reads the tenant's name from `GET /auth/branding`
  (public; resolved from the subdomain).
- Seeds and defaults have generic names (`seedDefaultWorkflows`, `DEFAULT_ROLES`,
  `STANDARD_BUILDING`, `STANDARD_PAYMENT_PLAN`, …).
- Values already stored in tenant databases (`policyKey 'ACCO_GOVERNANCE'`,
  `PENDING_ACCO_CONFIRMATION`) stay as they are. They are data, not code, and renaming them would
  need a data migration for no user benefit.
- Printed documents take the company's details from organisation settings (Administration →
  Branding), never from code.

## 2. Company templates (built: Step 1b)

Rukna ships a **platform default** for each template, and each company may keep an **editable copy**
of it.

- Stored on `organizations.payment_plan_template` / `schedule_template` (JSONB). NULL means the
  Rukna default is in force; "Reset to Rukna default" writes NULL back.
- Owned by `business/construction/company-templates`. The defaults live in
  `domain/default-templates.ts` and the save rules in `domain/template-rules.ts`: stages total
  exactly 100%, at most one advance, 1–20 stages; 1–30 phases with unique names, each 1–365 days.
- A save returns every broken rule at once (`TEMPLATE_INVALID`, `details.problems`) and is audited.
- The contract payment-plan builders and the schedule wizard (`STANDARD_BUILDING`) read the copy in
  force. Administration → Templates edits both.

## 3. Design system (built: Step 1c)

Option A, "Rukna Blue", was chosen over Pillar Teal and Site Indigo + Amber. Component code is
unchanged: only token values moved.

| Token | Before | Now |
|---|---|---|
| `--brand-primary` (hover / active) | `#255edb` | `#2453e0` (`#1c42b8` / `#1a3891`) |
| `--brand-panel` (sidebar, navy headers) | `#172033` | `#111d42` |
| `--background` / `--foreground` | `#f4f6f8` / `#172033` | `#f6f7f9` / `#0f1729` |
| `--border` / `--muted-foreground` | `#dce1e8` / `#667085` | `#e4e7ec` / `#5b6475` |
| `--surface-selected` / `--brand-accent` | `#eaf0ff` / `#edf2ff` | `#eef3ff` |
| `--success` / subtle | `#087f5b` | `#0b7a43` / `#e8f6ee` |
| `--warning` / subtle | `#9a5b13` | `#94570a` / `#fdf4e3` |
| `--danger` / subtle | `#b4232f` | `#c8291e` / `#fdecea` |
| `--historical` (retention, superseded) | `#6941c6` | `#6a45e8` / `#f1edff` |

- **Type scale:** 30 / 22 / 16 / 14 / 14 / 13 / 12 / 11 px (display, h1, h2, h3, body, body-sm,
  caption, micro). h3 shares the body size; its 600 weight sets it apart.
- **Spacing:** a 4 px grid.
- **Controls:** 28 / 36 / 38 / 44 px. The default control is 38, `sm` is 36 and `lg` is 44 (the
  touch target). 28 is reserved for in-row icon actions. Compact density stays at 34.
- **Radius:** 6 (control) / 8 (panel) / 12 (container) / 16 (overlay: dialog, sheet, drawer).
- **Icons:** Lucide only, 16 px in controls and 20 px in navigation. Every icon-only button has an
  accessible name.
- **Accessibility:** text contrast at least 4.5:1, visible focus ring (`--shadow-focus`), 44 px touch
  targets on phone flows, colour never the only signal (status badges keep their dot and label),
  and every form error listed by field.
- **Categorical chart series:** the existing CVD-validated `--series-1…5` are kept. The mockup's
  six-hue palette was illustrative and is not adopted until it is validated the same way.
- **Living reference:** `/design` (the gallery) shows every token at its current value. Update it
  in the same change as any token.

## 4. Grill decisions for later steps (not yet built)

| Topic | Decision |
|---|---|
| Phone flows | An installable web app (PWA), not a native app. |
| Reading photos (receipts, delivery notes) | Built now, alongside the phone flows, using free or open models behind a pluggable reader with a configurable provider (OpenRouter free vision models or self-hosted). A person always confirms the reading before anything is saved. The privacy implications of the chosen provider are confirmed with the owner at that step. |
| Saved table views | Personal views, plus views an admin publishes to everyone. |
| Approvals | One Approvals tab with a count, not an inbox per module. |
| Finance Home | A dashboard, with the setup checklist shown until setup is complete. |
| Navigation | An icon-only sidebar that can be collapsed; the Payables count and the period label stay. |

## Consequences

- A new tenant gets a working platform with neutral defaults and adapts it from Administration,
  with no code change.
- Token changes reach every screen at once. Screens that hard-coded a size or colour (an arbitrary
  `text-[Npx]` or a hex value) do not follow the tokens and must be fixed when they are touched.
- Future screens are reviewed against §3. A deviation needs an amendment to this ADR.
