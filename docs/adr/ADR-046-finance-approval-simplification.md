# ADR-046 — Finance approval simplification: owner decisions of 2026-10-27

**Status:** Accepted — decisions confirmed by the product owner (Abdulsalam) on 2026-10-27, with
Eng Ahmed's agreement for the ADR-022 change (§1). §1 is built; §2–§8 are decided and not yet built.

*Numbering note:* main's highest ADR before this was ADR-045. The unmerged branch
`docs/platform-multi-entity` must renumber its tenant-group ADR past this one.

## Context

The finance review of 2026-10-27 (Rukna Finance Refinement Plan, Phase 0–2) found that most
approval clicks on finance documents add effort without adding control: one permission covers
create, approve and post, so the "approver" is often the same kind of user as the preparer. Users
are migrating from QuickBooks, where a document posts on Save and approvals are opt-in. ACCO's
finance team is small. This ADR records the owner's answers to the eight decisions that drive that
complexity. ADR-022's real controls — payment value bands, dual bank signatories, the SoD pairs
other than the journal exemption, and the three-way match — are unchanged.

## Decisions

### 1. Journals — `post-own:journal` (amends ADR-022 CONST-DOA-003)
A preparer holding `post-own:journal` may approve and post their own journal without a second
person. The CFO and Finance Officer hold it by default (the CFO also gains `manage:journal`);
admins can grant or remove it per role. Everyone else keeps journal preparer ≠ approver, enforced
at approve and at post-from-SUBMITTED. The exemption never applies to someone else's journal.
Approval chains for journals can still be configured later through the governance seam.
*Built 2026-10-27:* permission in `packages/types/src/permissions.ts`; check in
`manual-journal.service.ts` (`mayActOnOwnJournal`); live-tenant grant
`prisma/seeds/grant-journal-self-post.seed.ts`.

### 2. Client invoices — one step: Issue
Draft is optional; Issue assigns the number and posts in one action. The separate Approve step is
removed. Approval can be switched on later by a setting, by amount.

### 3. Supplier bills — Save posts; approval by setting
A bill that matches its PO within tolerance posts on Save. A non-PO bill posts on Save unless a
setting requires approval above an amount. Goods receiver ≠ bill approver (ADR-022) stays wherever
an approval happens.

### 4. Supplier payments — auto-approve below the lowest band
Payments within the lowest ADR-022 band (≤ $1,000, Finance Officer authority) post on Save without a
separate Approve click. The CFO and CFO + CEO bands and dual bank-signatory release are unchanged.

### 5. IPC invoices bill the net amount due
The invoice shows gross certified, less retention, less advance recovery, equals amount due.
Retention is posted to a Retention Receivable account and billed later with a release invoice;
advance recovery clears the client advance. (Closes Finance Refinement Plan gap C2; amends the
ADR-023/ADR-024 billing model.)

### 6. Customer payments land straight in the bank
Receive payment picks the bank account and posts there. No holding ("Undeposited Funds") account.

### 7. Reopening a closed period — permission plus a written reason
Anyone holding the reopen permission (CFO by default) reopens with a mandatory reason, which is
audited. No second person.

### 8. Settings over code
Each optional approval in §2–§4 is an organisation setting that defaults to off, so approvals can be
added later without a code change, in line with ADR-008 §3 ("services must not embed amount bands or
approver roles").

## Consequences

- Fewer clicks: a matching PO bill goes from four actions to one; an invoice from three to one.
- The approval model moves toward per-action permissions (Finance Refinement Plan, Phase 2).
- §5 changes receivables and needs a chart-of-accounts entry (Retention Receivable) and a data plan
  for invoices already issued gross.
- Holders of `post-own:journal` act without a second person, so the audit log is the control for
  their journals; access reviews should check who holds it (risk class CRITICAL).
