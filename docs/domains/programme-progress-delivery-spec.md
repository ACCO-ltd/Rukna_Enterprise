# Programme & Progress - Frozen Policy and Delivery Specification

Status: `POLICY_FROZEN / DESIGN_READY / NOT_IMPLEMENTED`

Business owner: Eng Ahmed Shirie, ACCO Ltd  
Engineering owners: Backend - Abdulsalam; Frontend - Abdimalik  
Prepared: 2026-08-14

This document is the continuation point for the Programme & Progress domain. ACCO has approved
the business policy below. The next step is an ADR and technical design, not another round of
business discovery. Implementation details should be resolved by engineering unless they reveal
a genuine contradiction with an existing locked invariant.

Implementation status remains `NOT_IMPLEMENTED`. This specification must not be used to imply
that Programme, DPR, progress measurement, delay management, or imports already exist.

> **Refined by ADR-021 (proposed) — read that first.** This frozen spec is the full ambition; ADR-021
> is the **smallest professional architecture that enforces the controls without becoming Primavera**,
> and it governs where the two differ:
> - **WorkPackage is an always-explicit control layer** (BOQ → WorkPackage → Activity); weight + owner
>   live on the WorkPackage.
> - **Measurement method is reused from `BoqNode.measurementMethod`** (already snapshotted into IPA) —
>   no parallel enum.
> - **PlatformFile (ADR-014) is a hard prerequisite** and is built first; it also unblocks Documents.
> - **Value-first sequencing:** PlatformFile → Progress core (DPR + measurement + roll-up + Overview
>   heartbeat + IPA pre-fill + physical-vs-financial signal) → Programme light (dates + milestones +
>   `ProgressTarget` curve). **Deferred:** dependency networks, P6/MSP import, recovery programmes,
>   formal DelayEvent/EOT/claims, EVM, CPM.
> - **Separated metrics:** physical / financial / quality / safety are distinct — no composite score.
> - **Commercial firewall** (progress suggests, QS confirms, never auto-bills) is shared with
>   ADR-018 `CONST-MATCH-013` and ADR-020 `CONST-BOQ-025`.

## 1. Purpose

Programme & Progress supplies the missing Time and Physical Completion vertices of project
control. It must answer:

- What is the approved plan?
- Which programme version currently governs the project?
- What work has been performed and independently verified?
- What is ahead, on plan, or delayed?
- What needs attention, who owns it, and what must happen next?
- What is the approved forecast, and how does it differ from an analytical forecast?

It does not decide commercial entitlement, accounting revenue, cost, or payment.

## 2. Frozen ACCO Decisions

The following decisions are approved business policy.

| ID | Approved policy |
|---|---|
| PROG-D01 | Rukna supports a hybrid scheduling model: native lightweight programmes and controlled external imports. |
| PROG-D02 | Import priority is Excel first, then P6 XML/XER, then MS Project XML. |
| PROG-D03 | Native scheduling initially covers activities, hierarchy, dependencies, milestones, dates, weights and progress. It is not a Primavera replacement. |
| PROG-D04 | Physical progress uses approved work-package weighting plus verified measured quantities. BOQ monetary value is not the default physical-progress weight. |
| PROG-D05 | DPR is recorded daily; weekly and monthly reports are formal consolidations of approved daily records. |
| PROG-D06 | DPR approval is configurable through the platform workflow engine. |
| PROG-D07 | An approved DPR may only be reopened through a controlled, authorized and audited command. Silent editing is prohibited. |
| PROG-D08 | BOQ and Programme use a many-to-many allocation model with explicit anti-double-counting invariants. |
| PROG-D09 | Baseline, update, recovery and revision programmes have immutable, versioned history. |
| PROG-D10 | Required approval depends on programme type; publishing a version never bypasses the configured workflow. |
| PROG-D11 | Project suspension never silently shifts activity or completion dates. Schedule consequences require impact assessment and an approved recovery/revised programme. |
| PROG-D12 | Delay is a formal `DelayEvent` with classification, evidence, affected activities, responsibility and potential EOT/variation/claim/cost/notice consequences. |
| PROG-D13 | `ProgrammeMilestone` and commercial/contract milestones are distinct aggregates but may be explicitly linked. |
| PROG-D14 | Physical progress may inform IPA preparation but never creates claimed or certified quantities automatically. |
| PROG-D15 | Evidence requirements are configurable by BOQ/work type and use the shared `PlatformFile` subsystem. Programme must not create separate file storage. |
| PROG-D16 | The approved programme forecast is authoritative. Analytical forecasts are separate management signals and never overwrite contractual or approved dates. |

## 3. Existing Locked Constraints

ADR-002 already defines:

- `CONST-PROG-001`: progress entries must reference an approved DPR.
- `CONST-PROG-002`: progress cannot exceed 100 percent for a BOQ item.
- `CONST-PROG-003`: approved progress is immutable; corrections require a controlled record.

The Programme ADR must extend or formally supersede ambiguous wording without silently changing
these invariants. In particular, the new work-package allocation model must explain how the
BOQ-item limit is enforced across many-to-many allocations.

## 4. Domain Ownership

`construction/programme` owns:

- programme identity and lifecycle;
- immutable programme versions;
- activities, hierarchy and dependencies;
- programme milestones;
- approved schedule baseline and forecast;
- work packages and physical-progress weights;
- BOQ-to-programme allocations;
- DPR lifecycle and verified measurements;
- delay events, impact assessment and recovery-programme references;
- import validation and provenance.

It does not own:

- BOQ scope, quantity, rate or price;
- contract value or contractual milestone lifecycle;
- IPA claimed quantity or IPC certified quantity;
- accounting revenue, cost, journals or settlement;
- procurement delivery truth;
- binary file storage.

Cross-domain references are plain IDs and read models. Preserve `ARCH-BOUNDARY-001`; enterprise
modules must never import construction services.

## 5. Proposed Aggregates

### Programme

Project schedule identity and governing-version references.

Key fields: `organizationId`, `projectId`, `code`, `name`, `calendarId`,
`governingBaselineVersionId`, `governingForecastVersionId`, status and audit timestamps.

### ProgrammeVersion

Immutable schedule snapshot after approval.

Types: `BASELINE | UPDATE | RECOVERY | REVISION`.

Lifecycle:

```text
DRAFT -> VALIDATING -> READY_FOR_REVIEW -> UNDER_REVIEW -> APPROVED -> GOVERNING -> SUPERSEDED
                     +-> REJECTED
```

### ProgrammeActivity

Version-owned schedule node: WBS hierarchy, dates, duration, calendar, weight, progress method,
constraints and external-source identity.

### ActivityDependency

Typed relationship: `FS | SS | FF | SF`, lag, predecessor and successor. Cross-version
dependencies are forbidden.

### ProgrammeMilestone

Schedule milestone with an optional explicit link to a contract milestone. Linking does not
merge their lifecycle or ownership.

### WorkPackage

Approved unit of physical-progress weighting and responsibility. Work packages may connect
multiple activities and BOQ leaves.

### BoqProgrammeAllocation

Many-to-many allocation between approved BOQ leaves, work packages and programme activities.
It records allocation basis and share without changing BOQ pricing.

### DailyProgressReport

Daily operational report for a project/site/date. Contains conditions, resources, narrative,
performed work, measurements, evidence and approval history.

Lifecycle:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
                         +-> RETURNED_FOR_REVISION
APPROVED -> REOPEN_REQUESTED -> REOPENED -> CORRECTED -> APPROVED
```

### ProgressMeasurement

DPR-owned verified measurement referencing work package, activity and optionally BOQ node.
Stores current-period and cumulative quantities plus evidence references.

### DelayEvent

Formal delay register item with classification, dates, affected activities, responsibility,
evidence, notices and potential downstream consequences.

### ProgrammeImport

Upload/import job containing source type, file reference, mapping configuration, validation
report, row-level errors, provenance and candidate programme version. Import never publishes.

## 6. Mandatory Invariants

1. Approved programme versions are immutable.
2. A project has at most one governing baseline and one governing approved forecast.
3. Publishing requires the configured workflow and authorization.
4. An imported programme is always a candidate version until explicitly approved.
5. An activity dependency may only connect activities in the same version.
6. Activity hierarchy must be acyclic and project/version scoped.
7. Work-package weights within an approved reporting scope must total exactly 100 percent.
8. The same measured quantity cannot contribute more than once through overlapping allocations.
9. Cumulative physical progress cannot be negative or exceed the approved measurable quantity.
10. Progress must originate from an approved DPR.
11. Approved DPRs and measurements are immutable outside controlled reopen/correction.
12. Suspension changes no dates by itself.
13. Delay assessment changes no contractual date by itself.
14. Analytical forecasts cannot become governing without approval.
15. Programme progress cannot create or modify an IPA/IPC automatically.
16. Every mutation is organization-scoped, project-authorized and audited.

## 7. Permissions and Workflow Triggers

Proposed permissions, subject to ADR confirmation:

```text
view:programme
manage:programme
import:programme
submit:programme
approve:programme
manage:programme-progress
create:dpr
submit:dpr
approve:dpr
reopen:dpr
manage:delay-event
approve:delay-impact
```

Proposed workflow triggers:

```text
programme.baseline.publish
programme.update.publish
programme.recovery.publish
programme.revision.publish
dpr.approve
dpr.reopen
delay.impact-accept
```

Capabilities returned by read models are presentation guidance only. Commands must re-enforce
authorization, lifecycle, tenancy and workflow rules.

## 8. API Specification

### Workspace queries

```text
GET /projects/:projectId/programme/summary
GET /projects/:projectId/programme/current
GET /projects/:projectId/programme/versions
GET /projects/:projectId/programme/versions/:versionId/activities
GET /projects/:projectId/programme/progress
GET /projects/:projectId/programme/daily-reports
GET /projects/:projectId/programme/delays
GET /projects/:projectId/programme/milestones
GET /projects/:projectId/programme/attention
```

### Commands

```text
POST /projects/:projectId/programmes
POST /programmes/:id/versions
PATCH /programme-versions/:id
POST /programme-versions/:id/validate
POST /programme-versions/:id/submit
POST /programme-versions/:id/publish
POST /programme-versions/:id/activities
POST /programme-versions/:id/imports
POST /projects/:projectId/daily-reports
POST /daily-reports/:id/submit
POST /daily-reports/:id/approve
POST /daily-reports/:id/request-reopen
POST /daily-reports/:id/reopen
POST /projects/:projectId/delay-events
POST /delay-events/:id/assess
POST /delay-events/:id/resolve
```

List queries must be paginated. Import parsing is asynchronous and idempotent. Every response
shape is backend-owned in `packages/types`.

## 9. Workspace UX Specification

Project navigation label: **Programme & Progress**.

Internal sections:

1. **Overview** - governing programme, planned/actual progress, schedule variance, forecast,
   current milestone, DPR coverage, open delays, attention and recent activity.
2. **Programme** - WBS/activity grid, dependencies, dates, version context and optional timeline.
3. **Progress & Measurement** - work packages, weights, measured quantities, evidence coverage
   and variance against planned progress.
4. **Daily Reports** - DPR register, create/review/approve/reopen flows and consolidations.
5. **Delays & Recovery** - delay register, responsibility, impacted activities, notices and
   recovery/revision linkage.
6. **Milestones** - schedule milestones and explicit contract-milestone links.
7. **Imports & Versions** - import jobs, validation, mapping, version comparison and publishing.

Desktop uses a restrained tab row; mobile uses a section selector. The first screen is a
management overview, not a dense Primavera clone.

### Overview summary strip

- Governing baseline/version
- Planned progress
- Verified actual progress
- Approved forecast completion
- Schedule variance

### Attention examples

- Programme missing or no governing baseline
- Update period overdue
- DPR awaiting approval
- Activity/milestone behind programme
- Missing required evidence
- Allocation weights invalid
- Open delay awaiting impact assessment
- Recovery programme required
- Import validation failed

Every item returns severity, responsible role, blocker and permitted action URL from the backend.

### Enterprise states

All sections require loading, partial-failure, retry, permission-restricted, empty, terminal,
locked-version and import-validation states. Support English, Arabic, RTL, dark mode, keyboard
navigation and 375px mobile without horizontal page overflow.

## 10. Imports

### Release 1 - Excel

- downloadable template;
- column mapping and preview;
- row-level validation;
- hierarchy/dependency validation;
- duplicate external-ID handling;
- explicit create-versus-update choice;
- immutable source provenance;
- idempotent retry.

### Release 2 - P6 XML/XER

Preserve external activity IDs, WBS, calendars, relationships, milestones and source metadata.
Unsupported fields must be reported, never silently discarded.

### Release 3 - MS Project XML

Use the same normalized import pipeline and validation report. Do not create a second programme
model per import format.

## 11. Delivery Gates

### Gate A - ADR and contracts

- Author Programme & Progress ADR.
- Reconcile ADR-002 constraints.
- Freeze state machines, permissions, workflow triggers and aggregate ownership.
- Define shared response contracts and error/reason codes.

Exit: architecture review approved; no unresolved ownership or invariant conflict.

### Gate B - Programme foundation

- Schema/migration, programme and immutable versions.
- Activities, hierarchy, dependencies and milestones.
- Validation, approval and governing-version commands.
- Summary/current/version read models.

Exit: tenancy, authorization, audit and version-immutability integration tests pass.

### Gate C - Excel import

- Template, parser, mapping, preview, validation and candidate version.
- Idempotency and provenance.

Exit: import round-trip and malformed/duplicate/dependency tests pass.

### Gate D - Work packages and BOQ allocation

- Work packages, weights and responsibility.
- Many-to-many BOQ/activity allocation.
- Anti-double-counting and 100-percent policies.

Exit: overlapping-allocation and cumulative-progress tests prove invariants.

### Gate E - DPR and verified progress

- DPR lifecycle, performed work, measurement and evidence.
- Workflow approval and controlled reopen.
- Weekly/monthly consolidated queries.

Exit: approved-DPR provenance and correction audit tests pass.

### Gate F - Delay, recovery and forecast

- DelayEvent, impact assessment and affected activities.
- Recovery/revision programme linkage.
- Approved versus analytical forecast separation.

Exit: suspension/date neutrality and forecast-authority tests pass.

### Gate G - Workspace UI and advanced imports

- Seven-section workspace with backend-owned actions/blockers.
- Arabic/RTL/dark/mobile/accessibility QA.
- P6 XML/XER, then MS Project XML.

Exit: full-stack journey and visual acceptance gates pass.

## 12. Test Strategy

- unit tests for dates, dependencies, weights, allocation and progress policies;
- repository integration tests for organization/project scoping;
- command tests for every lifecycle transition and permission denial;
- concurrency tests for governing-version uniqueness and DPR approval/reopen;
- import fixtures for valid, partial, duplicate, cyclic and malformed schedules;
- boundary tests proving progress does not mutate BOQ, IPA, IPC or contract dates;
- frontend tests for actions, blockers, restricted states and partial failures;
- Playwright at desktop/mobile, English/Arabic, LTR/RTL and light/dark.

## 13. Deliberately Deferred

- Primavera-equivalent resource leveling;
- automatic critical-path optimization beyond validated relationships and dates;
- earned-value management unless separately approved;
- automatic commercial claim/certification from progress;
- automatic EOT, variation, cost claim or contractual-date changes;
- AI forecast promotion to an approved programme;
- Programme-specific binary file storage.

## 14. Tomorrow Start Checklist

1. Read this document, ADR-002, ADR-016, domain boundaries, tenancy and constraints.
2. Confirm the next ADR number and author the Programme & Progress ADR.
3. Resolve only genuine conflicts: ADR-002 BOQ-item measurement versus work-package allocation,
   and PlatformFile availability versus the evidence requirement.
4. Produce the schema/entity diagram and command/state transition table.
5. Implement Gate B only after the ADR review passes.
6. Do not expose the project navigation tab until its first useful read model and route exist.

## 15. Definition of Done

The domain is complete only when approved programme history, verified DPR-backed physical
progress, delay/recovery control, backend-owned guidance, audit/security, bilingual responsive
UX, tests and synchronized documentation all pass. A schedule grid alone is not completion.
