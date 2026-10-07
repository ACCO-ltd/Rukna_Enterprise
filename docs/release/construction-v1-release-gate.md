# Construction v1 — Release Gate

Status: DRAFT (gate not yet run)
Date: 2026-10-07
Owner: Abdulsalam (Platform Owner). Domain sign-off: Eng Ahmed Shirie (ACCO).
Related: ADR-044 (freeze precedes the multi-entity work); [[project-platform-multi-entity]].

---

## 1. Purpose and what "freeze" means

Construction is feature-complete. Before opening any new domain (Inventory, then Manufacturing), we run **one deliberate release gate** that verifies the whole construction system works **as one chain**, end to end, under real conditions — not module by module.

**Freeze definition.** Once this gate passes and ACCO signs off:
- No new *features* in the construction domain. Bug fixes only.
- Engineering attention moves to the **Entity-Boundary Audit** (ADR-044) and then **Inventory** (`src/business/inventory/`).
- Any construction change after freeze requires a one-line justification referencing a production defect or an ADR.

This document is the checklist. It is PASS/FAIL. Partial is FAIL.

---

## 2. Scope — the two chains the gate must prove

The gate verifies the two canonical flows as single transactions-of-record, with money and state crossing every module boundary:

**Chain 1 — Cost → GL → Project P&L**
`Project → Contract → BOQ → Progress → Certification → Material Request → PO → GRN → Supplier Bill → AP → Supplier Payment → GL → Project P&L`
Commitment flows COMMITTED (PO confirm) → ACCRUED (GRN post) → ACTUAL (Bill post); payment reduces AP.

**Chain 2 — Revenue → GL → Project P&L**
`Progress/Certification → IPA → IPC → Client Invoice → AR → Payment Receipt → Revenue → Project P&L`
IPC certifies; invoice posts Dr AR/Cr Revenue; receipt posts Dr Bank/Cr AR with allocation.

**Current coverage (from code+test audit, 2026-10-07):** 24 hops — **19 fully tested, 5 partial, 0 broken or missing links.** Full hop-by-hop tables are in the audit appendix (section 9).

---

## 3. Gate structure — three tiers

| Tier | What | Current automation | Gate rule |
|---|---|---|---|
| **A — Automated** | lint → type-check → unit + DB-integration tests → build → migrations clean | ✅ Runs in CI on every PR and on `main` (`.github/workflows/ci.yml`, Postgres 16 service, both schemas migrated before tests) | **Must be green.** ~2,851 API cases (real Postgres) + ~3,854 web cases. |
| **B — End-to-end** | 8 Playwright journeys incl. `billing-chain`, `project-finance-qa`, `project-procurement-qa`, `release-workflows`, `responsive` (375px) | ⚠️ **Workflow authored** (`.github/workflows/e2e.yml`), pending first green run — was local/manual only | **Must pass on a clean seed.** Workflow added (see 5.B1); flip to a required check once first run is green. |
| **C — Manual scenario sign-off** | the gate scenarios in section 4 + the post-deploy smoke tests in `docs/commercial/deployment-checklist.md` | manual | **Signed off by Abdulsalam + Eng Ahmed** on a staging run. |

---

## 4. Gate dimensions — status and required scenarios

Legend: **STRONG** (enforced + tested) · **UNTESTED** (enforced, no test) · **WEAK** · **VERIFY** (conflicting evidence, must confirm) · **CONFIRM** (likely by-design, needs product yes).

| # | Dimension | Status | Evidence / gap | Gate action |
|---|---|---|---|---|
| 1 | Tenant isolation / no cross-tenant leakage | **STRONG** | AsyncLocalStorage + per-tenant Prisma + JWT tenant-mismatch (`jwt.strategy.ts:26`); middleware never reads tenant from header (tested). | Add one explicit E2E assertion: token for tenant A rejected on tenant B. |
| 2 | Authorization / RBAC | **STRONG** | `PermissionsGuard` AND/OR, catalog validated. Gap: no *integration* test that an under-privileged user is 403'd on a sensitive endpoint. | Add 2 integration tests: user without `approve:purchase-order` and without `post:journal` rejected at controller. |
| 3 | Workflow / approval / SoD | **STRONG** | 7 SoD rules all unit-tested + wired (`sod-wiring.spec.ts`, `manual-journal.governance.spec.ts`); maker≠approver tested. | Confirm each gate is ON in the ACCO seed used for the gate run. |
| 4 | Period locking / post-into-closed | **STRONG** | `period-posting.policy.ts` + `FOR UPDATE` lock + EXCLUDE overlap constraint (migration `20260929120000`). | Add one concurrent close-vs-post race test (close wins → posting refused). |
| 5 | Idempotency / concurrency | **STRONG (receipts) / partial (other)** | Payment-receipt idempotency **CONFIRMED + TESTED** (2026-10-07): `PaymentReceipt.idempotencyKey` + partial unique index (migration `20260918100000_receipt_idempotency_key`) + service early-return in `recordProjectPayment`. Regression test added & green — Scenario K in `commercial-lifecycle.db.spec.ts`. GL posting dedups by source doc; IPC→invoice race (P2002) tested. Remaining: no optimistic-locking / sequence-race tests. | **A1 CLOSED.** Optional (defer): optimistic-lock tests for high-contention aggregates (PO/Contract/BOQ). |
| 6 | Audit trail | **UNTESTED** | Transactional outbox is atomic (`transactional-audit-outbox.service.ts`); interceptor logs mutations. No test proves a *sensitive domain command* (PO approve, journal post, IPC issue) writes the audit+outbox rows in the same tx. | Add 2–3 integration tests asserting audit row + outbox event created, and roll back together on failure. |
| 7 | Document / file authorization | **STRONG** | `file-authorization.service.spec.ts` covers tenant isolation, project-membership, TEMPORARY→BOUND→IMMUTABLE, the P0-1 cross-project regression. | None (spot-check in E2E `project-documents-qa`). |
| 8 | IPC immutability | **VERIFY** | `ipc.service.spec.ts` asserts CONST-IPC-001; model uses atomic *supersession* rather than a `FROZEN` column. Two audit passes disagreed on the mechanism. | **VERIFY** the enforced path: confirm a certified IPC's amounts cannot be mutated in place (supersession-only), and that the test actually exercises a mutation attempt. |
| 9 | Ledger append-only | **STRONG (scoped)** | Commitment ledger (= the three-stage COMMITTED/ACCRUED/ACTUAL "cost ledger") never updates/deletes — PO cancel writes negative entries (`procurement.spec.ts T14`). `StockLedger` does **not exist yet** — correct, inventory is the *next* domain, out of v1 scope. | Note StockLedger as N/A for v1 in sign-off. |
| 10 | Partial payments (AR + AP) | **STRONG** | `al.spec.ts AL-02/AL-04`, `payment-allocate-on-create.spec.ts`. | Cover in Chain scenarios below. |
| 11 | Reversals | **STRONG (unit) / thin (integration)** | Credit notes + PO-cancel reversals implemented; `credit-note` has no live-DB spec, receipt-reversal guards are mocked in `al.spec.ts`. | Promote credit-note → GL and receipt-reversal guards to one live-DB integration test each. |
| 12 | Variation financial impact | **STRONG (revenue) / CONFIRM (cost)** | Revenue side fully tested (`variation-billing-allocation.integration.spec.ts`, exactly-once). Cost side: variations do **not** write to the commitment ledger. | **CONFIRM with Eng Ahmed** this is by-design (ACCO variation cost flows via BOQ/MR, not VO→commitment). If by-design, document it; if not, it's a gap. |
| 13 | Overdue handling | **CONFIRM** | Aging buckets + WhatsApp reminders exist; no hard *block* on overdue. | **CONFIRM** manual collection is the intended policy (no automated hold). Likely yes. |
| 14 | Project P&L (ADR-013) | **STRONG** | `project-financial-position.service.spec.ts` — cost stages + certified/invoiced/received revenue, explicitly no forecast. | Assert in E2E `project-finance-qa` against a project that has gone through both chains. |
| 15 | Architectural boundaries | **STRONG** | No production imports cross ARCH-BOUNDARY-001/002 (procurement/accounting ↛ construction). No lint rule enforces it. | Add a cheap CI guard (grep/eslint-no-restricted-imports) so a future violation fails the build. |

---

## 5. Must-close punch list (before freeze)

Prioritised. Each item names the fix and how it is verified.

### Blockers (gate cannot pass)
- **A1 — Payment-receipt idempotency — ✅ RESOLVED 2026-10-07.** Mechanism is enforced at two layers: the DB (`PaymentReceipt.idempotencyKey` + a *partial* unique index `WHERE idempotency_key IS NOT NULL`, migration `20260918100000`) and the service (`recordProjectPayment` returns the existing receipt on a repeat key, short-circuiting before any posting). Regression test added and green — **Scenario K** in `apps/api/src/business/construction/commercial/__tests__/commercial-lifecycle.db.spec.ts`: K-01 proves a repeat key returns the same receipt and creates no duplicate; K-02 proves the DB refuses a second row for the same non-null key (holds under concurrent double-submit) while allowing many null keys. The earlier audit's "field not found" was a stale read. **No open blockers.**

### High (strongly recommended before freeze)
- **B1 — Put the E2E suite in CI. ◐ Workflow authored 2026-10-07; pending first-run shakeout.** `.github/workflows/e2e.yml` runs on PRs + `main`: Postgres service → provision `acco` tenant → seed accounting foundation → activate governance → `pnpm build` → start API (:3001) + web (:3000) → Playwright (desktop + 375px) → upload report. Not yet observed green on a Linux runner — the one genuine unknown is whether the **IPA submit transition** seeds cleanly in a provisioned + DOA-activated tenant, or whether SoD requires a dedicated approver / governance left off (see the workflow's `FIRST-RUN WATCH` comment). **Action:** open a PR to trigger the first run, read the logs, iterate, then make it a **required status check**.
- **C1 — Audit-trail integration tests (dimension 6).** Prove PO-approve / journal-post / IPC-issue each write audit + outbox atomically.
- **C2 — Reversal integration tests (dimension 11).** One live-DB test each for credit-note→GL and receipt-reversal guards (currently mocked).
- **C3 — IPC immutability verification (dimension 8).** Confirm + test that a certified IPC cannot be mutated in place.

### Medium (close or explicitly defer with a reason)
- **D1 — RBAC endpoint-rejection integration tests (dimension 2).**
- **D2 — Period close-vs-post race test (dimension 4).**
- **D3 — Boundary CI guard (dimension 15).**
- **D4 — Expand supplier-bill posting-eligibility tests** (sparse per audit).

### Confirm-with-Ahmed (product policy, not code)
- **E1 — Variation cost impact** is by-design (dimension 12).
- **E2 — Overdue = manual collection**, no automated hold (dimension 13).

---

## 6. Verify-vs-confirm (uncertainties surfaced by the audit)

These are **not** assumed either way; the gate must resolve them:
1. Payment-receipt idempotency — ✅ **RESOLVED 2026-10-07**: exists, DB-enforced (partial unique index), now covered by Scenario K. (A1)
2. IPC immutability mechanism — supersession-only, mutation blocked? (C3)
3. Variation→cost-ledger absence — by-design? (E1)
4. Overdue hard-block absence — by-design? (E2)
5. StockLedger absence — confirmed N/A for v1 (inventory is next domain). ✅ resolved.

---

## 7. How to run the gate

```bash
# Tier A — on main (or the release candidate), requires Postgres 16
pnpm lint
pnpm type-check
pnpm test            # ~2,851 API (real DB) + ~3,854 web cases; CI already gates this
pnpm build

# migrations clean
pnpm --filter @erp/api exec prisma migrate status   # expect: no pending

# Tier B — full stack up, then the end-to-end journeys
pnpm dev                                   # API :3001 + web acco.localhost:3000
pnpm --filter @erp/web run test:e2e        # 8 journeys incl. billing-chain + responsive(375px)

# Tier C — manual, on staging, following docs/commercial/deployment-checklist.md smoke tests
```

The production deploy itself is already safe: `deploy/deploy.sh` does backup → pull → build → migrate-check → image-check → health-check with auto-rollback and 14 retained backups. The gate is about *correctness before* that machinery runs.

---

## 8. Exit criteria (sign-off)

Construction v1 is **FROZEN** when all are true:

- [ ] Tier A green on the release candidate (lint, type-check, test, build) and `migrate status` clean.
- [ ] Tier B: all 8 Playwright journeys green on a clean seed (run recorded).
- [ ] Tier C: deployment-checklist smoke tests pass on staging.
- [x] Blocker **A1** resolved — receipt idempotency verified + tested (Scenario K green, 2026-10-07).
- [ ] High items **B1, C1, C2, C3** done (or explicitly deferred with written reason).
- [ ] Confirm items **E1, E2** answered by Eng Ahmed and documented.
- [ ] Both chains demonstrated once, end-to-end, on staging, producing a correct Project P&L (cost + revenue) for one project.
- [ ] Sign-off recorded: Abdulsalam (platform) + Eng Ahmed (domain).

On sign-off: tag the release, update `docs/01-capability-matrix.md` (last verified 2026-08-14/09-01 — stale), and open the **Entity-Boundary Audit** per ADR-044.

---

## 9. Out of scope / explicitly deferred

- Multi-entity, Group, consolidation — ADR-044, gated on Eng Ahmed's two answers.
- Inventory, Manufacturing — the domains this freeze unblocks.
- Known deferred domain questions already on record: receipt allocation A12, supplier edit A15, reconciliation as-of/tolerance, SoD opt-in defaults, posting-profile revenue categories, 5% hard-coded invoice tax.
- Dependabot: 76 alerts on the default branch (13 critical/41 high) — real, but a dependency-hygiene workstream, not a construction-correctness gate item. Track separately.

---

## Appendix — chain hop coverage (audit, 2026-10-07)

**Chain 1 (cost):** MR→draft ✅, MR→approve ◐, MR→PO ✅, PO confirm→COMMITTED ✅, PO supersede ✅, PO cancel ✅, GRN post→ACCRUED ✅, Bill draft ◐, Bill post→ACTUAL ✅, AP→GL ◐, Supplier payment ✅, commitment consolidation ✅, GL P&L ◐, Project P&L ✅. (8 full / 3 partial of the money hops; 0 broken.)

**Chain 2 (revenue):** Progress→verified ✅, verified→IPA prefill ✅, IPA draft→submit ◐, IPA→IPC ✅, IPC freeze ✅, IPC→invoice ✅, variation→invoice adj ✅, invoice→GL ✅, revenue recognition ✅, receipt ✅, allocation ✅, credit note ◐, project revenue P&L ✅. (11 full / 2 partial; 0 broken.)

Key test files: `procurement/__tests__/procurement.spec.ts` (T01–T15), `accounting/__tests__/al.spec.ts` (AL-01–AL-11), `construction/variations/__tests__/variation-billing-allocation.integration.spec.ts`, `accounting/financial-position/.../project-financial-position.service.spec.ts`, `construction/ipc/.../ipc.service.spec.ts`, `accounts-receivable/.../client-invoice.service.spec.ts`.
```
