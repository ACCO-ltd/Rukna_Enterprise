# Frontend-First Plan: Client and Project Creation

**Status:** Project experience implemented; remaining backend projections tracked below
**Date:** 2026-08-13
**Method:** Define the professional user journey first, then derive backend contracts.

## 1. Product Principle

Client and Project creation are one connected setup journey, not two unrelated forms:

`Client registry -> Create client -> Client workspace -> Create project -> Project setup checklist`

The frontend owns guidance, progressive disclosure, review, and recovery. The API owns
identity, tenancy, permissions, business eligibility, uniqueness, atomicity, and audit.
Business rules must never be duplicated as UI-only checks.

## 2. Current-State Findings

### Client creation

Current strengths at initial audit:

- Typed React Hook Form and Zod validation.
- Atomic creation of the client and optional primary contact.
- Server-generated immutable client code.
- Unsaved-change warning and bilingual messages.
- Clear field-level and form-level error summary.

Professional UX gaps:

- A long single-page form gives every optional field equal visual weight.
- No lightweight duplicate warning while entering name or tax number.
- No Arabic legal/trading name input although `nameAr` exists in the API/schema.
- Currency is a hardcoded frontend list rather than organization configuration.
- Address is one unstructured text area, limiting later invoice/document use.
- Success jumps directly away without offering the natural next task: create a project.
- Primary contact has no role/title and cannot be reviewed as a distinct entity.

Backend gaps:

- No duplicate-candidate query for normalized name or tax number.
- No normalized uniqueness policy for tax number; concurrent duplicates are possible.
- Create/update/contact mutations do not write transactional audit/outbox records.
- `GET /clients` is an unpaginated full-registry response and cannot support enterprise
  search-backed pickers.
- Error responses do not reliably identify a field.
- Currency options are not exposed from organization monetary configuration.

### Project creation

Current strengths:

- Three-step create flow with step validation and review.
- Client preselection via `?clientId=` and an explicit invalid-reference state.
- Active clients only in the ordinary picker.
- Confirmed non-blocking warning for a preselected inactive client.
- Immutable-code warning and automatic creator enrollment as Project Manager.
- Date-order validation and unsaved-change protection.

Professional UX gaps:

- Project codes were manually invented; creation now allocates `PRJ-YYYY-####` atomically.
- Client selection is a native select populated from the entire registry; it does not scale.
- Users cannot create a missing client without abandoning project setup.
- No save-and-resume draft behavior across sessions.
- Review does not show project manager identity, client status, or setup consequences.
- After success there is no structured next-step handoff to contract, BOQ, team, or dates.
- Loading and failure states for the client registry are incomplete.

Backend gaps:

- Project, creator membership, and Project Manager role are separate writes rather than one
  transaction. A failure can leave a partially initialized project.
- Project creation does not write transactional audit/outbox evidence.
- Duplicate project code is detected by pre-read plus database constraint, but the response
  is only a generic `409`; no availability endpoint or suggested replacement exists.
- New client-contract projects require an active, same-tenant client. Internal-capital projects
  cannot reference a client.
- There is no search/pagination endpoint designed for client pickers.
- There is no draft-resume contract beyond the created Project aggregate itself.

## 3. Target Client Experience

### Step C1: Identity

Fields: legal/display name, Arabic name, client type, tax number. Show the server-generated
code as `Assigned after creation`, not an empty editable field.

Behavior:

- Debounced duplicate check after meaningful name/tax input.
- Candidate matches are warnings, not automatic blockers.
- User can open an existing match in a new tab or continue with explicit acknowledgement.
- Exact tax-number conflicts follow the confirmed uniqueness policy; until confirmed, warn
  only and do not invent a hard block.

### Step C2: Contact and billing

Fields: primary contact name, role/title, phone, email, billing address, default currency.
Optional sections start compact and expand when used.

### Step C3: Review and create

Show only entered data, duplicate acknowledgement where applicable, and what happens next.
Submission is idempotent and disables repeated commands.

### Success state

Display assigned client code and two commands:

- Primary: `Create project for this client`
- Secondary: `Open client workspace`

The primary route is `/projects/new?clientId={createdClientId}`.

## 4. Target Project Experience

### Step P1: Identity and commercial model

Capture the project name, commercial model, participation model, client when applicable, and
location. The ordinary picker contains active clients only. Project code is never editable in
the create UI; the server assigns the next organization/year sequence inside the create
transaction.

### Step P2: Delivery basics

Fields: name, Arabic name, location, planned start, planned completion, description. Dates are
optional but when both exist the API and UI enforce completion on/after start.

### Step P3: Ownership and review

Show client status, creator as initial Project Manager, immutable code, entered dates, and the
initial DRAFT state. Explain that commercial value belongs to the main Client Contract.

### Success state

Open the project workspace with a setup checklist ordered as:

1. Confirm project details
2. Add team members
3. Create main client contract
4. Create/baseline BOQ
5. Submit project for approval

Checklist completion must be derived from backend records, not local browser state.

## 5. Required Backend Contracts

### B-CP-01: Searchable client picker

`GET /clients?query=&status=&type=&cursor=&limit=`

Returns a paginated projection:

```json
{
  "items": [
    {
      "id": "...",
      "code": "CLI-000123",
      "name": "ACCO Ltd",
      "nameAr": "...",
      "taxNumber": "...",
      "type": "COMPANY",
      "status": "ACTIVE"
    }
  ],
  "nextCursor": null
}
```

Rules: tenant-scoped; stable cursor ordering; maximum limit; permission `view:client`.

### B-CP-02: Client duplicate candidates

`GET /clients/duplicate-candidates?name=&taxNumber=`

Returns candidate IDs, display facts, and machine-readable match reasons such as
`NORMALIZED_NAME` and `EXACT_TAX_NUMBER`. It must not expose clients outside the active tenant.
Whether exact tax number blocks creation remains a business decision.

### B-CP-03: Client create command quality

`POST /clients` must:

- accept an idempotency key;
- create client and primary contact atomically;
- allocate code atomically;
- record transactional audit/outbox evidence;
- return the created client summary including primary contact;
- return stable error codes and field paths.

### B-CP-04: Project code allocation (implemented)

`POST /projects` allocates `PRJ-YYYY-####` from a tenant/year sequence. Legacy callers may
temporarily provide `code`, but the professional create UI omits it. The database uniqueness
constraint remains authoritative under concurrency.

### B-CP-05: Atomic project initialization

`POST /projects` must create the Project, creator membership, Project Manager role, and audit
event in one tenant-database transaction. Retrying with the same idempotency key returns the
original result and cannot duplicate membership.

### B-CP-06: Project client eligibility (implemented as command validation)

Client-contract projects require an active same-tenant client. Missing/cross-tenant clients
return `404`; inactive clients and invalid commercial-model/client combinations are blocking
validation errors. Internal-capital projects omit the client field.

### B-CP-07: Structured validation errors

All creation endpoints should return stable error details:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Review the highlighted fields",
    "details": {
      "fields": {
        "code": ["PROJECT_CODE_TAKEN"],
        "expectedEndDate": ["DATE_BEFORE_START"]
      }
    }
  }
}
```

The frontend maps codes to localized messages. The backend must not make English text its API
contract.

## 6. Build Sequence

### Slice 1: Backend integrity first

Implement B-CP-05 and audit coverage for both create commands. This fixes partial-write and
traceability risks without waiting for visual redesign.

### Slice 2: Picker and duplicate services

Implement B-CP-01, B-CP-02, and B-CP-04 with tenant, permission, pagination, normalization,
and concurrency tests.

### Slice 3: Client creation UI

Build the three-step client flow, duplicate warning, Arabic field, compact optional sections,
and success handoff to Project creation.

### Slice 4: Project creation UI

Replace the full-registry select with the searchable picker, add code guidance, strengthen
loading/error states, and expand review/success/setup states.

### Slice 5: Contract hardening

Implement B-CP-03, B-CP-06, and B-CP-07, then add EN/AR, RTL, dark mode, keyboard, 375px,
permission, concurrency, and API integration coverage.

## 7. Business Confirmations Needed

Only these decisions require Eng Ahmed; engineering should not infer them:

1. Is Tax Number unique per organization, and does an exact match block creation?
2. Is Arabic client/project name optional or required for ACCO?
3. Is project code generated from an organization sequence, manually entered, or both?
4. May a user create a new client inline while creating a project?
5. Should partially entered forms persist across sessions, and for how long?

## 8. Acceptance Gates

- No cross-tenant search, duplicate, or ID disclosure.
- Create commands are atomic, idempotent, authorized, and transactionally audited.
- No hardcoded role-name authorization in frontend or backend.
- Every backend error is stable and localizable.
- English and Arabic parity; correct RTL ordering.
- Light and dark modes pass contrast checks.
- Keyboard-only completion works with logical focus movement.
- 375px layout has no clipping or overlapping sticky actions.
- Slow, empty, offline, `400`, `403`, `409`, `422`, and retry states are verified.
- Client-to-project handoff preserves the created client without re-entry.

## 9. Evidence Limit

This plan is based on the current frontend components, tests, DTOs, services, repositories,
schema, and accepted architecture. The local web/API servers were not running during this
review, so a screenshot-backed visual audit and real-browser accessibility pass remain the
first verification task once the environment is available.
