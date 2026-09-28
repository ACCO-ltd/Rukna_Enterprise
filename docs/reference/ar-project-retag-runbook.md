# Runbook: AR project-tag reclassification

**Decision:** option C, approved by the owner on 2026-09-28. The correction is only posted if the audit finds affected postings.

## Why this exists

Before PR #226, two kinds of journal left the project off their revenue line:

- invoice reversals (`EVT-AR-002`)
- credit notes (`EVT-AR-007`)

Company revenue was correct. But each affected project's revenue, and its P&L in the Finance tab, still included amounts that had been reversed or credited. PR #226 fixed new postings. This runbook corrects the old ones.

Posted journals are never edited. Each affected line gets its own correcting journal:

- It is balanced and uses the same revenue account.
- It moves the line's amount onto the project it should have carried.
- It is linked back to the line it corrects.

## What the tool guarantees

The code is `apps/api/scripts/ar-project-retag.ts`. Its rules are in `ar-project-retag.policy.ts` and its engine in `ar-project-retag.runner.ts`.

**The audit is read-only.** For each affected line it reports:

- the source invoice, or credit note and invoice
- the intended project, account and amount
- the accounting period and its status
- the effect on that project's revenue

It writes all of this to a JSON report with a fingerprint.

**Nothing is posted without the accountant's approval.** Apply only accepts the approved report file:

- It re-audits first.
- If anything has changed since approval (a line corrected, an amount changed, a period closed), it refuses and posts nothing.

**Re-running is safe.** Each correction is keyed `ar-project-retag:<lineId>`:

- Lines that are already corrected drop out of the audit.
- A repeated apply posts nothing.

**Closed periods are never touched.** Each correction is dated on the corrected line's own accounting date. A line in a CLOSED or LOCKED period is reported as `BLOCKED_PERIOD` and never posted. Reopening a period is a separate decision, made through Setup & close.

**It all commits at once, or not at all.** One transaction posts every correction, then checks:

- Every account's net balance is unchanged, so the trial balance and company revenue are unchanged.
- Each affected project's revenue moved by exactly the expected amount.
- No other project's revenue moved.

If any check fails, the whole transaction is rolled back.

**Stale snapshots are flagged.** Period balance snapshots covering the corrected periods, or later periods in the same year, are marked INVALID. The output lists the periods that need an authorised rebuild in Setup & close. Project finance figures are computed live, so there is no other cache to rebuild.

**If nothing is affected, nothing happens.** A zero-line audit says so, and there is nothing to approve or post.

## Steps (on the server, inside the API container)

1. **Audit (read-only).**
   ```
   pnpm tsx scripts/ar-project-retag.ts --slug=acco --out=retag-report.json
   ```
   If it reports **0 lines**, stop. Nothing needs to be posted.

2. **Accountant review.** Send `retag-report.json`, together with the printed summary, to the accountant. They approve every READY line. For any BLOCKED line, they decide separately whether its period should be reopened.

3. **Apply the approved report.** Do this in a quiet window. If another AR posting lands while it runs, the checks fail safe and nothing is posted; run it again.

   The tool enforces the approval:
   - `--approved-by` must be an active user with `manage:journal` permission.
   - It must be a different person from `--actor`.
   - Each correction is written to the audit log, together with the report's fingerprint.

   ```
   pnpm tsx scripts/ar-project-retag.ts --slug=acco --apply \
     --approved-report=retag-report.json --approved-by=<accountant userId> --actor=<your userId>
   ```
   The output lists:
   - each correction's journal number
   - the proof result
   - the Billing–GL gap for each affected project, before and after. Each gap must move by exactly the corrected amount, or nothing is kept. If any gap is left afterwards, it isn't caused by missing tags and is reported for separate review.
   - any snapshots that need rebuilding

4. **Check again later (read-only).**
   ```
   pnpm tsx scripts/ar-project-retag.ts --slug=acco --verify --approved-report=retag-report.json
   ```

5. If the output named any stale snapshots, rebuild them through Setup & close.

The test at `apps/api/src/business/accounting/__tests__/rt.spec.ts` proves the whole cycle against a real database. It seeds the historical defect, then checks the audit, refusal of a tampered report, apply with its proofs, the Billing–GL gap clearing, and a no-op re-run.
