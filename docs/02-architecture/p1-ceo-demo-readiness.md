# P1 — ACCO CEO Demo Readiness and Workflow Decisions

Status: Active — governance activation gated  
Owner: Abdulsalam and Abdimaalik (technical preparation), Eng Ahmed Shirie (business authority)  
Last updated: 2026-08-11

## Purpose

This document keeps the CEO demo useful without silently turning draft workflow assumptions
into live financial controls. It records the decisions ACCO must make before workflow
activation and gives the team a repeatable, read-only demo route.

## Safe Readiness Check

Run this before every local demo:

```bash
pnpm --filter @erp/api run tenant:demo-readiness --slug=acco
```

The command is read-only. It reports tenant status, demo records, ADMIN access readiness,
workflow definitions/bindings, and required workflow policies. It never outputs credentials
or database URLs.

## CEO Demo Route

Use existing ACCO data. Do not create, approve, post, cancel, or activate workflows during
the meeting.

1. Sign in as the ACCO administrator at `http://acco.localhost:3000/login`.
2. Open Dashboard: establish portfolio visibility and bilingual navigation.
3. Open a Project: show project context, team membership, BOQ, and contract links.
4. Open a Contract and associated IPA: explain cumulative valuation and retained commercial
   history.
5. Open an IPC: show certified quantities, deductions, immutable/effective certificate
   status, and payment-status visibility.
6. Open Procurement: show the MR → PO → GRN → supplier-bill matching control flow and the
   commitment stages (`COMMITTED → ACCRUED → ACTUAL`).
7. Open Audit Logs and Roles: show that privileged actions and access are controlled.

### Do Not Demonstrate as an Active Live Control

- New approvals or workflow activation: ACCO governance is captured in an effective-dated
  policy version, but it has no formal effective date. Unconfirmed PO mapping/VAT basis and
  unconfirmed approval chains remain inactive.
- New payment receipt settlement: the demo tenant may not contain a suitable receipt.
- Supplier payment or financial posting: these are financial transactions, not demo clicks.

## Confirmed Governance

- Reporting currency: USD; evaluated from the reporting-amount snapshot at submission.
- Every Material Request requires approval; above USD 1,000 adds CFO and above USD 10,000
  additionally adds Group CEO.
- The central SoD rule set and an explicit audited emergency route are approved.
- Audit evidence and outbox publication are designed to be transaction-bound for migrated
  commands; audit-log visibility is permission-based.

## Decisions Still Required Before Workflow Activation

The rows below are proposals captured from ADR-003 and the current workflow templates. A
blank decision means **do not activate** the corresponding definition or binding.

| Control area | Existing draft chain | CEO decision required |
|---|---|---|
| Purchase Order | No active chain | Map USD 10,000–50,000 and above USD 50,000 to authorities; confirm net or gross including VAT basis. |
| Supplier Payment | No active chain | Confirm approver chain, thresholds, and operational controls. |
| Project lifecycle | Lifecycle locked; no active binding | Confirm approvers for each transition. |
| IPA / IPC | Separate configurations; no active chains | Confirm each approval chain and return/revision authority. |
| Delegation | No active configuration | Confirm permitted delegates and effective dates. |
| Escalation | No active configuration | Confirm escalation hours, fallback role, and notification recipients. |
| Emergency / exception / Board | Explicit route required; no active configuration | Confirm eligible cases, authority, evidence, and Board-referral conditions. |

## Activation Gate

Engineering may activate a workflow only after all items below are recorded and approved by
Eng Ahmed:

- [ ] Formal policy effective date is recorded.
- [ ] PO authority mapping and VAT threshold basis are agreed.
- [ ] Every required role maps to a real ACCO user/role.
- [ ] Segregation-of-duties conflicts are reviewed.
- [ ] Delegation and escalation rules are agreed.
- [ ] A non-production dry run is approved.
- [ ] Approval-instance initiation and completion behavior is verified end-to-end.
- [ ] The activation change is independently reviewed and audited.

`WorkflowDefinition.isActive` and `WorkflowTriggerBinding.isActive` must remain `false`
until this gate is complete, per `ARCH-DOA-003`.

## Current Technical Follow-ups

1. Authenticated browser smoke tests need the local administrator’s password or an explicitly
   authorized local password reset.
2. Apply the governance migration to each tenant database, then run `tenant:demo-readiness`
   to verify the policy remains `SCHEDULED`, has no effective date, and has no active SoD rule.
3. Migrate each scoped mutation (auth/role/permission, project lifecycle, PO, supplier bill,
   supplier payment, configuration) to the transaction-bound audit/outbox writer before claiming
   it complies with the same-transaction audit invariant.
