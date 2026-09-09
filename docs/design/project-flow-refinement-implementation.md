# Project flow refinement implementation

Date: 2026-09-09
Status: Implemented locally; validation and browser review recorded below. Not deployed.

## Scope

The approved refinement keeps the existing sidebar, blue brand, project routes, and business module ownership. It changes the client-to-project journey and the presentation of project preparation, BOQ, progress, procurement, finance, documents, team, and lifecycle decisions.

## Delivered behavior

- Client creation keeps one form, omits the generated code input, and collapses optional notes. Client editing no longer validates a contact-name field that is absent from the editor. The empty client Activity view is removed.
- Project creation uses one form. Delivery arrangements remain available in a disclosure. Creating a client from this form returns the created client to the project without losing entered project details. Inactive clients are not offered for new client-contract projects.
- Lists show a clear control only when search or domain filters are active. Project value distinguishes missing from permission-restricted data.
- Project preparation reads `GET /projects/:id/readiness?command=start`. A draft main contract no longer counts as readiness to commence. Conditions show responsible roles and permission-aware destinations; completed conditions collapse. This UI does not calculate a second business readiness percentage.
- Project lifecycle commands are primary on Overview. Working tabs keep a quiet preparation link. Suspended projects retain resume access across tabs. The shell no longer fetches an unused workspace summary on every working tab.
- BOQ retains its working grid. When the backend guidance supplies a main-contract creation action for the current baseline, that action takes priority; revision stays in the menu.
- Contract creation inherits the project/client, automatically selects one eligible baseline, and requires explicit selection when several are eligible. Sections use the common plain form treatment. Cancelling returns to the project's Commercial workspace. The create-only payment-plan limitation is stated beside the plan.
- Team actions use a compact row menu and an Add member dialog. Manage permission is required; project access remains established by the authorized members read. Existing last-manager and self-removal protection remain. Roles appear once in each row and remain editable.
- Progress setup is a vertical checklist with untruncated descriptions. Performance panels wait for an allocated, weighted progress model. A failed setup query is an error, not an empty/healthy model.
- Procurement starts with one actionable empty state when no pipeline activity exists. Actual purchasing activity still opens the existing cost and procurement pipeline. Purchasing remains in the shared Procurement module.
- Finance preserves the cost position when accounting is unavailable. Accounting setup details collapse into the accounting panel instead of repeating the same attention warning. Permission-aware setup links use the server's destination.
- Documents omit empty summary metrics and filter controls before the first document. The first-document state owns the create action; filtering an existing register still retains filters and summary.
- Commencement collects actual date and optional note; closure collects date and summary. Waivable conditions require individual reasons. CFO/CEO commencement exceptions follow the existing ADR-026 affordance, with server enforcement unchanged. Approval gates do not claim a successful transition; the open dialog retains the submitted evidence for retry.

## Constraints preserved

- `ARCH-BOUNDARY-001`: no enterprise module imports from construction were added; this change is frontend-only.
- ADR-019 `CONST-PLC-005/006/008/009`: readiness, mandatory/waivable conditions, evidence, and audit enforcement remain backend-owned.
- ADR-026 `CONST-VAR-011`: only the existing CFO/CEO at-risk commencement exception is surfaced.
- ADR-023 `CONST-COM-012`: milestone payment plans remain conditional, create-only, and subject to existing validation.
- Existing tokens, next-intl catalogs, typed API seams, and permission controls are retained. No dependencies or database migrations are added.

## API limits that the UI must not misrepresent

1. Several closeout/closure conditions are explicitly deferred by the readiness API. The decision dialog lists them for separate review; it cannot certify final-account settlement, inventory reconciliation, retention release, or document completion automatically.
2. Approval gate evidence is retained in the open dialog. The existing API does not provide a project approval inbox or a durable pending-command evidence record for another approver to resume. This change does not invent those capabilities.
3. The approval-step endpoint exposes a recorded step without a definitive terminal instance status. Completing the project command is the authoritative check after approvals. The obsolete claim that the backend does not enforce approver roles has been removed; the service now enforces organization, role, and segregation-of-duties checks.
4. Milestone payment plans cannot be amended through the existing contract PATCH endpoint.

## Validation

Focused tests cover form validation, client editing and handoff, inherited contract context, lifecycle evidence serialization, approval retry behavior, permission-aware team actions, document states, and financial truthfulness. Final results are recorded after the last run.

The full workspace type check currently encounters eight errors in the pre-existing, untracked `apps/web/src/features/documents/components/documents-tab.tsx`. That file is outside this change and is preserved. Browser QA requires an authenticated local session at `http://acco.localhost:3000`; no production records are changed for validation.
