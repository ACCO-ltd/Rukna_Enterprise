# Project preparation sequence refinement

Status: Implemented on `feat/project-preparation-order`

## Audit evidence

The production project overview was inspected on 2026-09-09 for a client-contract project in
Preparation. The BOQ was already baselined, while the main contract had not been created. The
readiness panel showed two visually equivalent actions:

1. Execute the main contract.
2. Set the contractual start date.

Both rows had an `Open task` action. Four completed conditions were collapsed below them. The
screen therefore exposed facts from the readiness API without explaining their dependency or the
work already completed.

## Domain sequence

The interface follows the existing fixed readiness policy in ADR-019. It does not change or
duplicate server enforcement.

1. Assign an active client.
2. Baseline the BOQ.
3. Create and execute the main contract against that BOQ.
4. Set the contractual start date.
5. Assign the delivery team.
6. Set planned project dates.
7. Record actual commencement through the guarded `Start project` command.

The client-contract path cannot create its main contract without a baselined BOQ. Team and
programme setup remain independent preparation activities and may proceed in parallel. Their
readiness conditions are waivable only through the existing condition-specific, audited exception
flow. The start command may also require workflow approval.

## Interaction rules

- Every server condition remains visible in its numbered position, including completed work.
- A condition is `Complete`, `Ready now`, `Blocked`, or `Exception allowed`.
- A blocked row names the prerequisite that must be completed first and exposes no action.
- An actionable row exposes `Open task` only when the current user has the required permission.
- The BOQ explicitly precedes the main contract; the contractual start date explicitly follows
  contract execution.
- The final panel explains that project commencement records an actual date and may require
  approval or condition-specific exceptions.

## Architecture and accessibility

Readiness truth continues to come from `GET /projects/:id/readiness?command=start`. The frontend
adds presentation order and navigation dependencies only; the API remains the authority under
CONST-PLC-004, CONST-PLC-005, CONST-PLC-006, CONST-PLC-008, and CONST-PLC-009.

The sequence uses an ordered list, visible text status badges, explicit dependency copy, and real
links for available actions. Status does not rely on color alone. Keyboard behavior and screen
reader announcements still require browser-level accessibility testing.

