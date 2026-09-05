**Design QA — Commercial workspace**

**Superseded 2026-09-05.** This note recorded a single P1: browser-rendered comparison was
blocked because `RUKNA_DEMO_PASSWORD` was not available, so no implementation screenshot could be
captured. That blocker is resolved and the work it describes has been redone at a different
scope.

Everything below it is also out of date in three ways: it describes the pre-refinement IA (the
five-metric band, a workspace header that no longer exists), it lists Arabic light/dark among the
required captures — Arabic was removed end-to-end in PR #73 — and it points at
`e2e/commercial-mobile.spec.ts`, which has been deleted.

Current state:

- Design decisions and their rationale: `docs/design/commercial-workspace-refinement.md`.
- The browser gate that replaced this note: `e2e/commercial-workspace-qa.spec.ts`. It measures
  page-level horizontal overflow, 44px touch targets, console errors and commercial 4xx across
  1440/375 × light/dark, and it fails rather than reporting — the seven defects it caught are
  listed in §8 of the design doc.
