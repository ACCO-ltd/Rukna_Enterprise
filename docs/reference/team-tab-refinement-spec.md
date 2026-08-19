# Team tab (project members) — refinement spec

Status: **Build-ready (low-risk).** Owners: Frontend — frontend engineer · Backend — Abdulsalam.
Source of truth: **ADR-022** (ACCO authority matrix), ADR-009 (Project Access Scope Resolver).

## Purpose

The Team tab's `ProjectRole` vocabulary predates ADR-022. It still offers `QUANTITY_SURVEYOR`
(ADR-022 **removed the QS** — Construction Director owns BOQ scope + cost) and treats
`COMMERCIAL_MANAGER` / `FINANCE_REVIEWER` as project-team roles, when ADR-022 makes them **org-level
authorities that flow through projects**. ACCO's real **project team = Site Engineer + Project
Manager** (PM absorbs Project Engineer + Coordinator), plus Viewer.

## The decision that keeps this cheap
**Do NOT change the `ProjectRole` enum.** It is used in ~15 files, including the commercial
`responsibleRole` type and the workflow seed — removing values is a breaking, cross-cutting migration
for no real gain. Instead, **restrict what the UI offers** (exactly the pattern used for `BillingModel`).
Existing data and the `responsibleRole` union keep working; stale roles simply become deprecated
(not offered, not assignable going forward).

## 1. Restrict the add-member role options (frontend)
`AddMemberForm` (in `project-members.tsx`) offers only the ACCO-real project roles:
```
Project Manager · Site Engineer · Viewer
```
Deprecate (do not offer): `QUANTITY_SURVEYOR`, `COMMERCIAL_MANAGER`, `FINANCE_REVIEWER`. Keep rendering
their labels for any *existing* member that still holds them (read-only), so history stays legible.

## 2. "Also has access" section (the ADR-022 two-dimension model)
ADR-022's core idea — **access scope ≠ project membership**. The Construction Director (all projects),
CFO, and other org authorities can see/act on a project **via their org role + the Project Access Scope
Resolver (ADR-009)**, not by being added here. Surface them so the team sees *who else can act*:
```
PROJECT TEAM  (managed here — add / remove)
  Ahmed Ali    Project Manager   [remove]
  Farah Nur    Site Engineer     [remove]
  + Add member → Project Manager | Site Engineer | Viewer

ALSO HAS ACCESS  (via org role — read-only, not managed here)
  Construction Director   all projects
  CFO / Finance           org authority
```
**Backend for this section:** a read model listing org-scoped users with access to the project,
resolved through `ProjectAccessScopeResolver` (ADR-009). Bounded, read-only. If not built yet, ship
§1 + §3 first and add "Also has access" when the resolver read is available.

## 3. Fix the "roles set once" gap (backend — small)
`project-members.tsx` documents: *"there is no endpoint that changes a member's roles; correcting one
requires remove + re-add."* Add a **`PATCH /projects/:id/members/:memberId/roles`** command
(governed like other membership mutations, audited) so a mistyped role is fixable without churn.
`ProjectMemberRole` is already versioned (`assignedAt` / `removedAt`), so the write closes the current
row and opens the corrected one.

## What stays the same
The tab's structure (member table: name · email · roles · remove) is fine — this is a **vocabulary +
one-endpoint** refinement, not a redesign.

## Gating / sequence
- **§1 (restrict roles)** — pure frontend, ship anytime.
- **§3 (roles-edit endpoint)** — small backend, ship anytime.
- **§2 ("Also has access")** — depends on an ADR-009 resolver read model; ship when available.
- No `ProjectRole` enum migration. If ACCO later wants the legacy roles physically removed + existing
  members remapped, that is a separate, deliberate migration confirmed with Eng Ahmed — not required
  for this refinement.
