# ADR-046 — Finance approval simplification: owner decisions of 2026-10-27

**Status:** Accepted — decisions confirmed by the product owner (Abdulsalam) on 2026-10-27, with
Eng Ahmed's agreement for the ADR-022 change (§1). §1, §2 and §5 are built; §3, §4 and §6–§8 are decided and not yet built.

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
*Built 2026-10-28:* `POST /invoices/:id/issue` refreshes the printed company details, approves a
draft and posts it in one transaction, so a refusal at posting leaves the draft untouched and
unnumbered. An invoice approved before this change issues by posting alone. The invoice page
offers "Issue invoice" (the journal preview first) in place of Approve then Post. `POST
/invoices/:id/approve` stays for compatibility. The approval-by-amount setting is §8, not built.

### 3. Supplier bills — Save posts; approval by setting
A bill that matches its PO within tolerance posts on Save. A non-PO bill posts on Save unless a
setting requires approval above an amount. Goods receiver ≠ bill approver (ADR-022) stays wherever
an approval happens.

### 4. Supplier payments — auto-approve below the lowest band
Payments within the lowest ADR-022 band (≤ $1,000, Finance Officer authority) post on Save without a
separate Approve click. The CFO and CFO + CEO bands and dual bank-signatory release are unchanged.

### 5. IPC invoices bill the net amount due — for this period
The invoice shows gross certified, less retention, less advance recovery, equals amount due.
Retention is posted to a Retention Receivable account and billed later with a release invoice;
advance recovery clears the client advance. (Closes Finance Refinement Plan gap C2; amends the
ADR-023/ADR-024 billing model.)

**Owner decision, same day — certificates are cumulative, invoices are per period.** IPA and IPC
quantities are cumulative to date (ADR-005 CONST-IPC-015), so `certifiedTotal` and the certificate's
deductions are figures *to date*. Invoicing the whole `certifiedTotal` re-billed every earlier
certificate. An IPC invoice now bills the certificate's cumulative figures **minus what earlier IPC
invoices on the same contract already billed** (draft or posted; cancelled and reversed invoices and
posted credit notes excluded). This also handles a superseding certificate: only the difference is
billed. Built 2026-10-27:

| Invoice field | Meaning (IPC invoices) |
| --- | --- |
| `certifiedGrossAmount` | gross certified this period (null on non-IPC invoices) |
| `otherDeductionsAmount` | other certificate deductions this period (TAX, CONTRA, …) |
| `subtotal` | revenue and tax base = gross − other deductions |
| `retentionAmount`, `advanceRecoveryAmount` | held back this period |
| `totalAmount` | amount due = subtotal + VAT − retention − advance recovery |

EVT-AR-001 for such an invoice: Dr Accounts Receivable (amount due) · Dr Retention Receivable
(retention) · Dr Advances received from clients (advance recovery) / Cr Contract revenue (subtotal)
· Cr Output VAT. EVT-AR-002 mirrors it. A period whose revenue or amount due would not be positive
is refused with the figures, so finance can correct earlier invoices with a credit note.

Commercial and Financial Position read the **latest** effective certificate as the contract's
certified-to-date figure instead of adding certificates up.

*Defaults to confirm with the ACCO accountant:* VAT is charged on the revenue amount (gross − other
deductions), so retention carries VAT when first billed and its release invoice carries none;
"other" deductions reduce revenue. ACCO V1 contracts carry no retention or advance recovery
(ADR-023 CONST-COM-013/014), so for them only the per-period fix changes anything. **Not built
yet:** advance billing into the client-advance account.

**Retention release invoice (built 2026-10-27).** Once a contract's retention is released
(`POST /contracts/:id/retention/release`, contract at FINAL_ACCOUNT_PENDING), `POST
/invoices/from-retention-release` raises an invoice (`sourceRetentionContractId`) for the retention
due: held on posted IPC invoices minus what posted release invoices already billed. It earns no
revenue and carries no tax: subtotal and VAT are zero, `retentionReleasedAmount` = amount due, and
EVT-AR-001 posts Dr Accounts Receivable / Cr Retention Receivable. Rules:
- Refused while an unposted IPC invoice still holds retention, or when nothing is due.
- One open draft at a time: raising again returns it while it still matches the amount due, and
  refuses (`RETENTION_DRAFT_STALE`) once it no longer does.
- Re-checked at post: a draft billing more than is now due is refused (`RETENTION_RELEASE_STALE`),
  so Retention Receivable never goes negative.
- A reversed release invoice no longer counts, so the retention can be invoiced again.
- Retention certified after a release is billed by a further (top-up) release invoice.
- An IPC invoice cannot be reversed once a posted release has billed its retention
  (`RETENTION_ALREADY_RELEASED`); reverse the release first.
The Billing To do shows a `RETENTION_TO_INVOICE` row for the amount due (Release and invoice /
Invoice retention), hidden while a release draft is open or an IPC invoice holding retention is
unposted. The commercial summary's retention held is net of posted releases. V1 releases all
retention at once (`retentionSplitOnPC` is not yet applied).

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
