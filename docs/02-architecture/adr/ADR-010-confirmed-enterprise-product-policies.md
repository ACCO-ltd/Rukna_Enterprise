# ADR-010: Confirmed Enterprise Product Policies

**Status:** ACCEPTED (partial decision set)
**Date:** 2026-08-13
**Decider:** Eng Ahmed Shirie, ACCO Ltd

## Scope

This ADR records only FP-01 through FP-12, NT-01, OS-01, WF-01, and UX-01. All other
questions in the decision sheet remain unresolved and must not receive inferred defaults.

## Financial Position

The projection uses the active main `CLIENT_CONTRACT`, effective IPCs in `CERTIFIED` or
`PARTIALLY_CERTIFIED`, posted client invoices, posted receipts and allocations, remaining
approved-PO commitments, and posted project-cost journal lines. Values use persisted,
approved exchange-rate snapshots and organization reporting currency. Portfolio scope is
`ACTIVE`, suspended projects, and `CLOSEOUT`; `DRAFT` and `CANCELLED` are excluded.

Formulas and selection constants live in
`financial-position/application/financial-position.policy.ts`. Queries and widgets must
consume that policy rather than restating statuses or formulas. Visibility uses the dedicated
`view:financial-position` permission. CFO, CEO, Finance Manager roles and explicitly
authorized administrators receive it through role configuration, never hardcoded role names.

## Notifications

Only approval assigned, returned for revision, rejected, project suspended, contract or
guarantee expiry warning, and overdue client invoice events are enabled. Recipient rules,
channels, read/archive semantics, auto-resolution, thresholds, and escalation stay inactive
until NT-02 through NT-07 are confirmed. The allowlist is
`notification-event.policy.ts`; it does not itself deliver notifications.

## Organization Settings

OS-01 permits the confirmed fields and excludes Base Currency. The request whitelist is
`organization-settings.policy.ts`. The current Organization persistence model does not
contain most fields, so no partial settings endpoint may be exposed until an effective-dated
schema, transactional audit, DTO validation, and permissions are implemented. OS-02 through
OS-05 remain unresolved except where an accepted earlier ADR already governs behavior.

## Workflow Publication

Publishing requires a known last editor and a different authorized publisher. The invariant
is `editorUserId != publisherUserId`, enforced by `workflow-publication.policy.ts`.
Publication must commit with its immutable audit record. The existing schema does not store
editor or publisher identity, so activation remains unavailable until audited edit/publish
commands and those fields are implemented. WF-02 through WF-06 remain unresolved.

## Enterprise UX Priority

The first accounting redesign is:

`Effective IPC -> Client Invoice -> Finance review -> Approval -> Posting -> Receipt -> Allocation -> Outstanding balance`

It includes IPC traceability, gross/net/VAT, lifecycle and permissions, allocation, journal
drill-down, reversal history, and edge states. Journals are not the first redesign priority.

## Compatibility Review

- **ADR-006:** No contradiction. Posted-only rules and snapshot conversion reinforce its
  GL/subledger source-of-truth and immutable exchange-rate requirements.
- **ADR-007:** No contradiction. Commitments consume its immutable commitment ledger without
  reversing the mandatory module dependency direction.
- **ADR-008:** No contradiction. Publication and future settings writes require transactional
  audit/outbox recording; notification delivery remains an asynchronous consumer.

## Unresolved Decisions

`GS-01..05`, `NT-02..07`, `OS-02..05`, `AP-01..05`, `WF-02..06`, and `UX-02..04` remain
inactive or unchanged from accepted architecture.
