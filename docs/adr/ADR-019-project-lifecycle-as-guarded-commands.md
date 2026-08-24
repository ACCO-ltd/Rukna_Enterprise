---
Status: accepted
---

<!-- Domain-approved by Eng Ahmed Shirie 2026-08-17 (see ADR-022 for approval chains + thresholds). -->

# Project lifecycle as guarded commands

## Status note

Two things are deliberately kept apart in this ADR:

- **Domain decision (frozen):** `APPROVED` and `MOBILIZING` are no longer canonical lifecycle
  phases; the canonical lifecycle is six states; every transition is a guarded command.
- **Implementation status (partial):**
  - **Phase A — state collapse: DONE** (migration `20260822130000_collapse_project_status_adr019`).
    `ProjectStatus` is now six states; `APPROVED`/`MOBILIZING` are gone. The retired
    approve → mobilize → activate chain collapsed into one `POST /projects/:id/start`
    (`DRAFT → ACTIVE`); the `DRAFT → ACTIVE` governance binding carries the approval `APPROVED`
    used to model (ADR-022). The UI presents `DRAFT` as **"Preparation"** (CONST-PLC-010).
  - **Phase B1 — readiness policy + read contract: DONE.** `ProjectReadinessPolicy`
    (CONST-PLC-005) is fixed domain code (`projects/domain/project-readiness.policy.ts`) branching
    on `commercialModel`; the queryable read contract (CONST-PLC-009) is
    `GET /projects/:id/readiness?command=start` → `{ command, targetStatus, ready, conditions[],
    deferred[] }`, each condition carrying `MANDATORY`/`WAIVABLE` severity. **Pure read — it does
    not yet block or mutate a command.** `start` carries the full queryable condition set
    (CLIENT_ACTIVE / ACTIVE_MAIN_CONTRACT / CONTRACT_START_DATE / BOQ_BASELINED are MANDATORY;
    PROGRAMME_DATES / DELIVERY_TEAM are WAIVABLE; INTERNAL_CAPITAL swaps the contract conditions
    for a deferred `INTERNAL_AUTHORIZATION`). practical-completion / closeout / close have **no
    queryable gate yet** — their source facts (PC certificate, final account, commitments,
    inventory, retention) don't expose project-scoped state, so they return `ready` with those
    named in `deferred[]` rather than faking a check.
  - **Phase B2 — guarded-command teeth: NOT built.** Enforcing readiness inside the commands,
    the per-condition `MANDATORY`/`WAIVABLE` waiver command shape (CONST-PLC-006, `override:
    { condition, reason, approvedBy }` — never `force: true`), and the evidence-consuming payloads
    (CONST-PLC-008: Start `actualStartDate`, Close `closureDate` + `closureSummary`) remain. Today's
    transitions still run through the existing `CommandGovernance` gate + `getWorkspaceGuidance`.

## Context

The Project lifecycle is `DRAFT → APPROVED → MOBILIZING → ACTIVE → PRACTICAL_COMPLETION →
CLOSEOUT → CLOSED` (+ `CANCELLED`). A domain review found two of those states are **activities
modelled as states**: `APPROVED` is an *authorization event*, and `MOBILIZING` is *readiness
work done before execution*. Leaving them as long-lived states makes the product feel like CRUD
around an enum — a $10M project sits in `APPROVED` for three weeks — and pushes teams toward a
generic "change status" control that bypasses the real preconditions.

A lifecycle state should exist only when it changes what the organization and system are
*allowed or expected to do*. `PRACTICAL_COMPLETION` and `CLOSEOUT` clear that bar (they mean
materially different contractual/financial phases). `APPROVED` and `MOBILIZING` do not.

## Decision

### CONST-PLC-001 — Canonical lifecycle (six states)
`DRAFT → ACTIVE → PRACTICAL_COMPLETION → CLOSEOUT → CLOSED`, with `CANCELLED` as the terminal
exit before successful completion. No other lifecycle states exist. `APPROVED` retires into a
workflow authorization event; `MOBILIZING` retires into readiness work performed while `DRAFT`.

### CONST-PLC-002 — Suspension is a condition, not a state
Suspension remains an independent operational condition (`ProjectSuspension`). A project is
`ACTIVE + suspended` or `ACTIVE + not suspended`; suspension never mutates the lifecycle state.

### CONST-PLC-003 — Three separated concerns
These are modelled independently and never conflated:
- **Readiness policy** — *what must be true* to enter a state.
- **Command governance** — *who must authorize* the transition.
- **Lifecycle state** — *where the project currently is*.

### CONST-PLC-004 — Every transition is a guarded command
```
Lifecycle transition =
    readiness evaluation
  + condition-specific waivers where permitted
  + required command evidence
  + governance authorization where required
  + state mutation
  + business audit event
```
There is **no generic "Change Status" control anywhere in the product.** The UI exposes business
actions (Start Project, Record Practical Completion, Begin Closeout, Close Project, Cancel
Project, Suspend/Resume) — never `Status: [ACTIVE ▼]`.

### CONST-PLC-005 — Readiness is a fixed domain policy, not a configurable engine
`ProjectReadinessPolicy` lives in domain code and branches on `commercialModel`
(CLIENT_CONTRACT requires client + active main contract + contractual start evidence;
INTERNAL_CAPITAL substitutes internal authorization/funding conditions) and, where genuinely
needed, `participationModel`. **No admin condition-builder / expression / effective-date
engine** — that would recreate the tolerance-engine complexity in a more dangerous place.
Configuration is introduced later only from evidence, not speculation.

### CONST-PLC-006 — Two condition severities
Each readiness condition is `MANDATORY` or `WAIVABLE` (binary; no third severity yet).
- `MANDATORY` — transition impossible until satisfied.
- `WAIVABLE` — blocked by default; an authorized override unblocks it, recording
  **condition + reason + actor + time + audit event.**
The override targets the **specific failed condition**, never the whole transition. `closeProject({ force: true })` is prohibited; the shape is
`override: { condition: OUTSTANDING_RETENTION, reason, approvedBy }`.

### CONST-PLC-007 — Governance per command (default)
| Command | Governance |
|---|---|
| Start Project | Configurable approval |
| Record Practical Completion | **Evidence-driven, no internal approval by default** |
| Begin Closeout | Readiness-only |
| Close Project | Mandatory approval (strongest gate) |
| Cancel Project | Mandatory approval |
| Suspend Project | Configurable/required approval |
| Resume Project | Lighter authorization than suspend |

Practical Completion records a **contractual fact** already certified by the contract-defined
authority (`certifiedBy` — client/consultant/engineer); ACCO is not re-approving it. The default
is evidence-only, but this is a *default*, not a hardcoded "PC can never require workflow" — the
`CommandGovernanceService` seam can demand approval for a project class whose policy requires it,
without changing the lifecycle model.

### CONST-PLC-008 — Commands consume domain state; they do not re-collect it
Preparation creates the prerequisite artifacts; a command validates them and records only the
*decision it introduces*:
- **Start Project** — readiness asserts a planned/confirmed start date and NTP record already
  exist; the command payload is `actualStartDate` (+ optional commencement note), not a
  re-entry of those facts.
- **Close Project** — pre-flight consumes final-account / commitments / inventory / documents /
  retention state; the command payload is `closureDate` + `closureSummary`. It never asks the
  user to re-enter facts already represented in domain state.

### CONST-PLC-009 — Readiness is queryable independently of the command
There is a read contract (endpoint/service) that returns *why* a project is not ready **before**
any command is attempted. The frontend renders the readiness dashboard from it; it must never
degrade into repeated failed commands to discover blockers.

### CONST-PLC-010 — UI label
The `DRAFT` enum is unchanged in the backend; the UI presents it as **"Preparation"** (or
"Pre-Execution"). The visible ladder is `Preparation → Active → Practical Completion → Closeout
→ Closed`.

## Migration (DONE — `20260822130000_collapse_project_status_adr019`)

State mapping applied:
```
DRAFT      → DRAFT
APPROVED   → DRAFT
MOBILIZING → DRAFT
ACTIVE     → ACTIVE
PRACTICAL_COMPLETION → PRACTICAL_COMPLETION
CLOSEOUT   → CLOSEOUT
CLOSED     → CLOSED
CANCELLED  → CANCELLED
```
**Before executing:** inspect existing `APPROVED`/`MOBILIZING` records for business meaning
(e.g., `APPROVED since 2026-06-01`, `MOBILIZING since 2026-06-10`) and **preserve transition
history** as audit/history events. Collapsing the state must not erase when a project was
approved or began mobilizing.

## Considered options

- **Keep the 8-state enum (rejected).** Encodes activities as states, invites a generic
  change-status control, degrades the product to enum-CRUD.
- **Delete PRACTICAL_COMPLETION / CLOSEOUT too (rejected).** These represent materially different
  contractual/financial phases (retention, defects, final account, closeout obligations that can
  last months). They earn their place.
- **Configurable readiness engine (deferred).** Recreates tolerance-engine complexity in a
  high-stakes area; introduce only from evidence.

## Consequences

- Backend blast radius (migration): `ProjectStatus` enum, transition graph, workflow bindings,
  service guards, existing records, queries/reports, frontend status assumptions, tests, audit
  consumers. This is corrective, cross-cutting work — staged, not a quick enum edit.
- New surfaces: `ProjectReadinessPolicy` (fixed, per commercialModel), the readiness read
  contract (CONST-PLC-009), condition-specific waiver command shape (CONST-PLC-006), and
  business-action commands replacing any status dropdown.
- Reuses existing patterns: the accounting close-gate pre-flight (readiness), 
  `CommandGovernanceService` (authorization), `ProjectSuspension` (condition).
- Gated on Eng Ahmed's domain sign-off before implementation.
