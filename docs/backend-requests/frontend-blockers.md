# Frontend → Backend Requests

Raised by: Frontend Engineer (`apps/web`, `packages/ui`)
For: **Abdulsalam** (backend, `apps/api`) — and where marked, **Eng Ahmed Shirie** (domain)
Raised: 2026-08-03 · Last re-verified: 2026-08-11, every open finding individually, at `4a895e7`

> **UPDATE 2026-08-13 — the Sprint 6 backend delivery merged to `main` (197 tests) closed most of
> the tracked backend findings.** Verified-and-closed on GitHub: **#24 (A1), #26 (A3), #27 (P6),
> #29 (P15), #30 (P8), #31, #33 (A14), #34 (A16), #35 (A17), #36 (A18), #42 (A19), #45 (B16),
> #25/#28 (RBAC — now enforced, HTTP-403 verified).** Still open by design: **A12** (receipts one
> ledger vs two — Eng Ahmed) and **#51/#49/#50** frontend-domain items. New backend capability
> now needs *frontend*: the governance `409` gate + loop-back, and the Project Actual P&L screen —
> planned in [`docs/01-capability-matrix.md`](../01-capability-matrix.md). The
> per-finding statuses below predate this update and are being reconciled.

Status: **all 37 open findings re-verified at `4a895e7`; all 37 are still open.** Three are
new, found during the same sweep: [A14](#a14) (blocking, [#33](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/33)),
[A15](#a15) and [B15](#b15). Three existing findings were **corrected** rather than merely
re-stamped — [P9](#p9), [P14](#p14) and [B13](#b13) each overstated or understated what the
code does; their stamps say how.

The sweep was run before starting the AP frontend build, and it found what the last two
sweeps found: that the register drifts in *both* directions. A1 and A3 were recorded as
blocking Client Invoices and every supplier-dependent screen; A1 never blocked invoices at all,
and A3 has been fixed since `7cf2507` while `procurement-api.ts` still rejects every call to
`GET /suppliers` with "does not exist". Nothing was wrong with the code — the register was
telling the frontend that a wall it had already walked through was still standing.

Fixed and confirmed still fixed in passing: A1 (`CustomerReceiptController` is at
`/customer-receipts`), A3 (`supplier.controller.ts` and `posting-profile.controller.ts` both
exist), C14 (`ipa.service.ts:18` accepts `RETURNED_FOR_REVISION`), P16
(`supplier-bill.repository.ts:47`).

This document is the source of truth for backend work the frontend is waiting on.
Items marked **Blocking** prevent a UI surface from functioning at all — they are not
feature requests.

Findings were produced by reading `apps/api/src` directly, not by inference from docs.

- **B-series** (Sprint 1–2 platform, projects, BOQ) — first raised against commit `e1f2139`.
- **C-series** (Sprint 3 commercial modules) — first raised against commit `776b695`,
  before frontend work on Contracts, IPA, IPC and Receipts began.
- **A-series** (Sprint 4 accounting) — raised against `e738bfe` 2026-08-09, during the
  contract sweep run before any accounting UI was written.
- **P-series** (Sprint 5 procurement) — raised against `97efe91` 2026-08-09, during the
  contract sweep run before any procurement UI was written.

**What is resolved, precisely.** Every B- and C-series finding that was *ticketed* is fixed
and its issue is closed, each verified individually on 2026-08-09 by opening the file named in
its row. The findings recorded only here — the ones whose status reads `in doc` — were never
ticketed and are **still open**: B6–B10, B12, B13, B15, C9, C10, C13, C15 and the D-series. They
are gaps and contract untidiness rather than blockers, which is why they were never filed, but
"the tracked issues are closed" is not "the list is clear".

One exception to that reasoning is now visible. B15 is a security finding and is untracked,
which puts it in the same position B5 and B11 were in before they were ticketed and fixed.
Untracked is not a severity judgement; it only records that nobody filed it.

### How to read the verification stamps

An earlier revision of this document carried a single blanket line — *"re-verified against
`776b695`: none are fixed"* — which was **wrong**: `776b695` had in fact fixed half of B5.
One inaccurate summary line made every finding below it untrustworthy at once.

The correction to that correction is instructive. C6 was also recorded as fixed on
2026-08-04, on the strength of the DTOs existing and their date and money fields being
typed correctly. A field-by-field comparison against `schema.prisma` the same day found
**13 of the 16 wrong**. Checking that a thing exists is not checking that it is right.

So verification is now recorded **per finding** rather than per document. Each entry carries
its own stamp, and each stamp means someone opened the file and looked:

> *Verified live at `c8afdd6` (2026-08-04).*

A finding with no stamp has not been re-checked since it was raised, and should be treated as
unconfirmed. A fixed finding keeps its entry, struck through, naming the commit that fixed it —
findings are not deleted, so that a reader can tell the difference between "resolved" and
"never existed".

---

## Summary

Status values: an issue link means it is tracked in GitHub; **in doc** means this document is
the only record and no ticket exists; **fixed** names the commit that resolved it.

### Sprint 4 — accounting (A-series)

Raised 2026-08-09 from the contract sweep against `e738bfe`. A1 and A3 (the two blocking
items of that batch) are resolved. A4–A10 are `in doc` — documentation and contract defects;
no blocking behaviour; frontend has workarounds. A11–A13 were added during the Tier G build,
and A14–A15 during the 2026-08-11 sweep — **[A14](#a14) is blocking and is now
[#33](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/33).**

> **Correction, 2026-08-10.** An earlier revision of this paragraph read *"A2/P5 (security,
> already implemented) are now resolved."* That was **wrong**, and the table below it was right
> the whole time — both rows still carry their open issue links. Verified at `a715984`:
> `src/common/decorators/` contains only `current-user.decorator.ts`, there is no
> `@Permissions` decorator and no permissions guard, and the `RolesGuard` registered as
> `APP_GUARD` in `app.module.ts:46` reads a `'roles'` metadata key that **no controller sets** —
> so it returns `true` on every request. There is still no authorization anywhere in the API.
>
> This is the same failure the document warns about at the top: checking that a thing exists is
> not checking that it is right. A summary line that contradicts its own table makes both
> untrustworthy.

| ID | Severity | Area | Summary | Status |
|---|---|---|---|---|
| [A1](#a1) | **Blocking — bug** | AR | Two controllers mounted at `/receipts`; Sprint 4's `CustomerReceipt` list/detail/allocate are shadowed and return the wrong entity with a `200` | **fixed** — `CustomerReceiptController` moved to `/customer-receipts`; `api-reference.md` §6.19 updated |
| [A2](#a2) | **Security** | Accounting | No authorization anywhere in the module — any authenticated user can close a fiscal year or reopen a period | [#25](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/25) |
| [A3](#a3) | **Blocking** | AP | `Supplier` and `PostingProfile` have no endpoints, so a supplier bill cannot be created at all | **fixed** — `GET/POST /suppliers`, `GET /suppliers/:id`, `GET /posting-profiles` implemented; §6.22–6.23 added |
| [A4](#a4) | **Contract — docs** | AP | §6.20 create-bill body is wrong in three places (`amount`, missing `vatAmount`, `postingProfileCode`) | in doc |
| [A5](#a5) | **Contract — docs** | COA | §6.13 omits the required `controlPostingPolicy`; the bulk-import example omits four required fields | in doc |
| [A6](#a6) | Contract | COA | `CreateAccountDto` accepts 2 of the schema's 3 `ControlPostingPolicy` values — the seeded bank accounts use the third | in doc |
| [A7](#a7) | Docs | AP | `GET /bills?status=` documented, not implemented | in doc |
| [A8](#a8) | **Docs** | Accounting | Every GL account code in §6.13–6.23 is 4-digit and none exists in the seeded 5-digit COA | in doc |
| [A9](#a9) | Contract | AP | Money is a JSON number on the whole AP write path, against the platform money-as-string rule | in doc |
| [A10](#a10) | Docs | GL | No `GET /periods`; periods are reachable only embedded in `/fiscal-years` | in doc |
| [A11](#a11) | **Correctness — bug** | AR | A REVERSED invoice passes the post guard and can be posted again, drawing a new `invoiceNumber` and orphaning the original journal | in doc |
| [A12](#a12) | **Domain** | AR / Finance | One receipt carries two unlinked allocation ledgers — to IPCs and to invoices — with no guard between them | [domain-questions.md](./domain-questions.md) |
| [A13](#a13) | Gap | AR | `ClientInvoiceRepository` embeds no `client` relation — P16's fix was applied to bills but not to invoices | in doc |
| [A14](#a14) | **Blocking — bug** | AP | `SupplierBill.purchaseOrderRevisionId` is never written by any code path, so no bill can be matched, the match gate is bypassed, and the commitment ledger never reaches ACTUAL | [#33](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/33) |
| [A15](#a15) | Gap | AP | No `PATCH /suppliers/:id` — supplier master data is write-once and a typo is permanent | in doc |

<a id="a11"></a>
### A11 — a reversed invoice can be posted a second time

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`client-invoice.service.ts:126,129` gates posting on `documentStatus === 'APPROVED'` and rejects
only `postingStatus === 'POSTED'`. Reversing leaves the invoice `APPROVED` / `REVERSED`, which
passes both checks.

`client-invoice.repository.ts:84-93` then sets `postingStatus: 'POSTED'`, writes a **new**
`invoiceNumber` drawn from the `INV-` sequence, and replaces `postedJournalEntryId` — while
`reversalJournalEntryId` still points at the reversal of a journal the invoice no longer
references. The audit trail from invoice to journal is broken, and a number already issued to a
client silently changes.

Suggested fix: gate on an allowlist (`NOT_POSTED`, `FAILED`) rather than excluding `POSTED`.
`OPENING_BALANCE` must also be excluded — the aggregate opening journal already carries its GL
effect, so posting it would double-count.

**The frontend is deliberately stricter than the server here**, in the same way `canPostBill` is
for P15. `canPost` in `features/accounting/invoice-actions.ts` implements the allowlist, and
three tests name the divergence. Do not reconcile the frontend to the server.

<a id="a12"></a>
### A12 — two allocation ledgers over one receipt, with no guard between them

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

There is no `CustomerReceipt` entity. `/customer-receipts` and Sprint 3's `/receipts` operate on
the same `payment_receipts` rows, and each has its own allocation table:

- `ReceiptAllocation` → receipt ↔ **IPC** (Sprint 3). Guards by summing its own rows against
  `receipt.totalAmount` (`finance.service.ts:80-90`).
- `ClientReceiptAllocation` → receipt ↔ **ClientInvoice** (Sprint 4). Guards against the
  `receipt.unallocatedAmount` **column** (`customer-receipt.service.ts:196`).

Sprint 3 never writes `allocatedAmount` or `unallocatedAmount` — verified across every write in
`src/business/finance/`. So a receipt fully allocated to certificates still reports its full
unallocated balance, and Sprint 4 will allocate the whole amount again to invoices.

**This may be correct by design.** `ClientInvoice.sourceIpcId` is one-to-one with an IPC, so
allocating to IPC X and to Invoice(X) is arguably the same settlement mirrored in a commercial
and an accounting ledger. But nothing enforces that pairing: allocating to IPC X and Invoice Y is
accepted just as readily, and then the two ledgers disagree about which certificate was paid.

**For Eng Ahmed:** are these two records of one settlement, or two settlements? If one, the
pairing needs enforcing. If two, the combined total needs a guard against the receipt amount.

No customer-receipt UI has been built pending the answer. Building an allocation screen on an
unresolved rule is how double-counted cash reaches a client statement.

<a id="a13"></a>
### A13 — AR did not get P16's fix

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`SupplierBillRepository` now includes `supplier { id, code, name }` on `findById` and `findAll`
(P16, fixed). `ClientInvoiceRepository.findAll` and `findById` include nothing
(`client-invoice.repository.ts:29,37`), so the client name is unresolvable from an invoice payload.

The frontend joins against `GET /clients`, which it already fetches, so this is a gap rather than
a blocker. Worth closing for symmetry — the same screen shape now needs two different data
strategies depending on which side of the ledger it is on.

Note also that neither repository returns `nameAr`. On the Arabic UI a supplier name renders in
English; the invoice screens avoid this only because the client join supplies both.

<a id="a14"></a>
### A14 — a supplier bill never links a PO revision, so nothing downstream of it works

**[#33](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/33) · Blocking — bug · verified at `4a895e7` (2026-08-11)**

`SupplierBill.purchaseOrderRevisionId` (`schema.prisma:1500`) is nullable and is **never written
by any code path**. `CreateSupplierBillDto` accepts `purchaseOrderId`, not the revision;
`supplier-bill.repository.ts:74` writes `purchaseOrderId` and nothing else. The only writer of a
`purchaseOrderRevisionId` anywhere in `apps/api/src` is `goods-receipt.service.ts:126`, writing
the GRN's own.

Three behaviours are gated on that field, and each fails silently rather than erroring:

| Gate | Source | Consequence |
|---|---|---|
| Matching | `bill-matching.service.ts:53` returns early when null | No bill created through the API can ever be matched |
| Post gate | `supplier-bill.service.ts:150` — `if (bill.purchaseOrderRevisionId && !POSTABLE…)` | The condition short-circuits, so every API-created bill posts unmatched |
| Commitment conversion | `supplier-bill.service.ts:245` — `if (… && bill.purchaseOrderRevisionId)` | ACCRUED never becomes ACTUAL; commitments stop at the GRN forever |

The post gate matters most. P15 was filed and fixed because `NOT_RUN` sat in
`POSTABLE_MATCH_STATUSES` and let an unmatched bill post. That fix closed one route to an
unmatched posting; this leaves a second one open, and it opens *before* the status is ever
consulted. **The three-way match gate is bypassed by construction, not by configuration.**

ADR-007's chain — `Supplier Bill (prefilled from GRN, matched) → ACCRUED −amount, ACTUAL +amount`
— is unreachable as built. Note also that nothing in the create contract can express *which*
GRN a bill settles, at header or line level; matching rediscovers the GRN line by querying
`goodsReceiptLine` on `purchaseOrderLineId` plus POSTED status.

**Frontend impact:** supplier bill create is built for **non-PO bills only** — utilities, rent,
services, whose revision ID is legitimately null and for which the match gate correctly does not
apply. PO-linked create stays disabled behind #33, and the Matching tab on a non-PO bill reads
"not applicable" rather than "not run". This is the fourth place the frontend is deliberately
stricter than the server, after A11, P15 and `canPostBill`.

<a id="a15"></a>
### A15 — supplier master data is write-once

**Gap · verified at `4a895e7` (2026-08-11)**

`supplier.controller.ts` exposes `GET /suppliers`, `GET /suppliers/:id` and `POST /suppliers`.
There is no `PATCH`. A supplier's `name`, `nameAr`, `taxNumber`, `defaultCurrency` and
`paymentTermsDays` cannot be corrected after creation, and there is no deactivation path either
— `status` is filterable on the list but nothing sets it.

A misspelt supplier name is therefore permanent and will print on every bill and payment
referencing it. Compare the catalogue modules, which at least have a `deactivate` command
(P2, P3), and `PATCH /clients/:id`, which exists on the AR side.

**Frontend impact:** the Suppliers screen ships list and create only, with no edit affordance.
An input that silently has no effect is worse than no input.

### Sprint 5 — procurement (P-series)

Raised 2026-08-09 from the contract sweep of §6.24–6.32 against the nine controllers in
`apps/api/src/business/procurement/`. All seven implementation defects (P6, P8, P10, P11,
P12, P15, P16) are now fixed. Remaining open items are `in doc` — no blocking behaviour.

| ID | Severity | Area | Summary | Status |
|---|---|---|---|---|
| [P6](#p6) | **Blocking — bug** | GRN | `@IsPositive()` on `acceptedQuantity` makes a fully rejected line impossible and `400`s the documented create pattern | **fixed** — changed to `@IsNumber() @Min(0)` |
| [P5](#p5) | **Security** | All | No authorization on any of the nine controllers — any authenticated user can approve a PO and commit company money | [#28](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/28) |
| [P15](#p15) | **Security — bug** | Bill matching | `POSTABLE_MATCH_STATUSES` includes `NOT_RUN`, so an unmatched bill posts to the GL; the three-way match gate is UI-only | **fixed** — `NOT_RUN` removed from `POSTABLE_MATCH_STATUSES` in `supplier-bill.service.ts` |
| [P8](#p8) | **Security** | MR | `projectId` and five other foreign keys are stored unvalidated — a cross-org `projectId` is accepted | **fixed** — `projectId` validated against org scope in `material-request.service.ts:create()` |
| [P11](#p11) | **Correctness — bug** | Commitment ledger | Superseding reverses the full original commitment, not the uncommitted balance — `COMMITTED` goes negative by the received amount | **fixed** — supersede reversal now sums net COMMITTED entries per line via `queryByPoLineAndStage()` |
| [P12](#p12) | **Correctness — bug** | Commitment ledger | Cancelling a PO writes no reversal — a cancelled order consumes commitment forever | **fixed** — `cancel()` rewritten with `prisma.$transaction()` writing `PO_CANCELLED` reversal for each active line |
| [P10](#p10) | **Correctness — bug** | GRN | `EXCEPTION_PENDING` is a dead end; nothing returns it to `DRAFT` and PO revision does not re-evaluate it | **fixed** — `POST /procurement/goods-receipts/:id/approve-exception` added; moves `EXCEPTION_PENDING` → `DRAFT` |
| [P4](#p4) | Contract | MR | No `close` endpoint — `CLOSED` is in the state machine and unreachable over HTTP | in doc |
| [P14](#p14) | Contract | PO | List embeds the highest-numbered revision without lines — §12.6's Total Amount is uncomputable and Revision is misleading. The supplier half is fixed: `findAll` now includes `supplier` | in doc |
| [P2](#p2) | Gap | Catalogue | `status` hard-coded `ACTIVE` in the service — deactivation is a one-way trapdoor and §12.4's status filter is unbuildable | in doc |
| [P1](#p1) | Gap | Materials | No `search` param, so §12.10's `MaterialPicker` filters client-side | in doc |
| [P9](#p9) | Contract | GRN | Over-receipt tolerance comes from an unexposed `OverReceiptPolicy`; §12.7's "5%" is the fallback and is correct until one is seeded — see the re-verification note | in doc |
| [P16](#p16) | Gap | AP | Bill repositories embed no `supplier` relation, so supplier name is unresolvable on every AP screen | **fixed** — `supplier { id, code, name }` included in `findById` and `findAll` in `supplier-bill.repository.ts` |
| [P17](#p17) | Contract | All | Money and quantity are JSON numbers on the write path, decimal strings on the read path — A9 extended to procurement | in doc |
| [P3](#p3) | Gap | UoM | Deactivation has no in-use guard, and P2 makes a client-side pre-check impossible too | in doc |
| [P7](#p7) | Contract | MR/PO | `uomCode` is required on every line and ignored on MATERIAL lines | in doc |
| [P13](#p13) | Contract | PO | `revise` requires a `supplierId` it discards | in doc |

### Sprint 1–2 — platform, projects, BOQ

Rows carrying a `fixed` stamp were re-verified individually against `e738bfe` on 2026-08-09.
Rows still reading `in doc` have not been fixed and have no ticket. Entries are kept rather
than deleted, so that "resolved" stays distinguishable from "never existed".

One consequence is worth carrying forward: fixing C7 and C8 together changed the shape of
`GET /receipts/certificate/:id/payment-status` from `{ totalAllocated: number, status }` to
`{ totalAllocated: string, netCertified: string, status }`. `apps/web` was not told, kept the
old type, and guarded a string with `Number.isFinite` — so every certificate rendered as
UNPAID, with the unit tests passing throughout because they mocked the old shape. Fixed in
`f15d7ab`. A correctness fix on the API is a breaking change for its consumers.

| ID | Severity | Area | Summary | Status |
|---|---|---|---|---|
| [B1](#b1) | **Blocking — bug** | Projects | No project can ever get its first member | **fixed** `e85bab9` — `project.service.ts:90` auto-enrols the creator as PROJECT_MANAGER, so the deadlock is broken at creation. The `assertMember` guard on `addMember` correctly remains. |
| [B2](#b2) | **Blocking** | Users | No endpoint lists users in an organization | **fixed** `e85bab9` — `GET /users` lists the caller's organization from the token. |
| [B3](#b3) | **Blocking** | Workflows | `GET` endpoint requires a request body — uncallable from a browser | **fixed** `e85bab9` — now `@Param('transactionType')`; no body. |
| [B4](#b4) | **Security** | Workflows | Approver identity is taken from the request body | **fixed** `e85bab9` — approve/reject use `identity.userId`; the body carries only `notes`. |
| [B5](#b5) | **Security** | Roles | `orgId` read from query string, unscoped by token | **fixed** `776b695` + `e85bab9` — reads `identity.activeOrganizationId`. |
| [B14](#b14) | **Blocking — bug** | BOQ | `move` always 500s and half-applies, corrupting descendant paths | **fixed** `e85bab9` — `moveNode` runs inside `prisma.$transaction([...])` and rewrites descendant paths; cycle, self-move and leaf-parent guards added. |
| [B11](#b11) | **Security** | BOQ | Version endpoints missing the organization check | **fixed** `e85bab9` — `boq-versioning.service.ts:36,182` throw `ForbiddenException` on org mismatch. |
| [B13](#b13) | Contract | BOQ | `move` never reindexes siblings, so positions can tie | comment on [#4](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/4) |
| [B6](#b6) | Contract | Several | Undocumented empty response bodies | in doc |
| [B7](#b7) | Correctness | BOQ | Money totals computed in floating point | in doc |
| [B8](#b8) | Scale | Projects | No pagination, search, or sort | in doc |
| [B9](#b9) | Gap | Users | No way to persist a language preference | in doc |
| [B10](#b10) | Gap | Projects | No summary/aggregate endpoint | in doc |
| [B12](#b12) | Gap | Types | `@erp/types` exports no Project or BOQ DTO | in doc |
| [B15](#b15) | **Security** | Workflows | `GET /workflows/instance/:id/step` takes no identity and is not org-scoped — any instance ID reveals any tenant's approval step | in doc |
| [D1](#d1) | **Domain** | BOQ | Mixed-currency nodes sum into one meaningless total | [domain-questions.md](./domain-questions.md) |
| [D2](#d2) | Docs | — | `api-reference.md` inaccuracies | in doc |

### Sprint 3 — commercial modules

| ID | Severity | Area | Summary | Status |
|---|---|---|---|---|
| [C2](#c2) | **Security** | IPC | `POST /ipc` checks nothing about the application it certifies | **fixed** `e85bab9` — `ipc.service.ts:54-62` requires the application to exist, be in the org, and be SUBMITTED. |
| [C3](#c3) | **Security** | IPA | Unit rate is taken from the request, not the contractual BOQ | **fixed** `e85bab9` — `ipa.service.ts:191` prices from `boqNode.unitRate`; the request cannot supply it. |
| [C16](#c16) | **Security** | Finance | A receipt can be allocated to another client's certificate, in another currency | **fixed** `e85bab9` — `finance.service.ts:62,67` reject a cross-client allocation and a currency mismatch. |
| [C1](#c1) | **Blocking — design** | IPC | Retention and advance-recovery arithmetic is delegated to the browser | **fixed** `68b056d` — `certifiedTotal` is computed from the items server-side and is absent from every IPC DTO; RETENTION and ADVANCE_RECOVERY are generated by the server. |
| [C7](#c7) | **Correctness — bug** | Finance | Payment status measures against gross, so a settled IPC never reads `PAID` | **fixed** `e85bab9` — `finance.repository.ts:103` compares against `netCertified`. |
| [C4](#c4) | Correctness | IPA | A line can be claimed beyond its contracted BOQ quantity | **fixed** `e85bab9` — `ipa.service.ts:171` rejects a cumulative claim above the contracted BOQ quantity. |
| [C5](#c5) | Contract | IPA | Workflow policy is resolved but no approval instance is created | no action needed |
| [C6](#c6) | **Contract — bug** | Types | Shared DTOs shipped, but 13 of 16 do not match the API | **mostly fixed** `e85bab9` — field names, money-as-string and dates now match. **Residual:** nullable columns are typed `field?: T` (optional) where the API sends `null`, and `null` is not assignable to an optional `T`. `apps/web` keeps its own `api-types.ts` with `T | null` for this reason. Re-raise before anyone adopts these DTOs. |
| [C8](#c8) | Contract | Finance | `totalAllocated` returns a number, breaking the money-as-string rule | **fixed** `e85bab9` — `totalAllocated` is `.toFixed(2)`. Broke `apps/web`, which still typed it `number`; fixed frontend-side in `f15d7ab`. |
| [C9](#c9) | Gap | BOQ | `measurementMethod` and `pricingBasis` can never be set | in doc |
| [C10](#c10) | Contract | Contracts | Retention split is spelled `…OnPc` in, `…OnPC` out | in doc |
| [C13](#c13) | Gap | Contracts | Cancel and terminate require a reason and discard it | in doc |
| [C14](#c14) | **Blocking — bug** | IPA | `RETURNED_FOR_REVISION` is a dead end — editable, unsubmittable | **fixed** `e85bab9` — `submit-for-approval` accepts `RETURNED_FOR_REVISION`, which is also in `MUTABLE_STATUSES`. |
| [C15](#c15) | Gap | IPA | Claimed items carry a bare `boqNodeId` — no code or description | in doc |
| [C17](#c17) | **Correctness — bug** | Finance | A negative allocation is accepted and defeats the over-allocation guard | **fixed** `e85bab9` — `finance.service.ts:74` rejects `allocatedAmount <= 0`. |
| [C18](#c18) | **Domain** | Contracts | The guarantee lifecycle has three names for one state and no `CANCELLED` | open — Eng Ahmed |
| [D3](#d3) | Docs | Clients, Contracts | Documented request shapes that return `400` | in doc |
| [D4](#d4) | **Domain** | IPA | May a claim go below what was already certified? | [domain-questions.md](./domain-questions.md) |

---

## Blocking

### <a id="b1"></a>B1 — No project can ever get its first member

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Blocking. This is a bug in shipped code, not a missing feature.

`ProjectService.addMember` requires the *caller* to already be an active member:

- `apps/api/src/business/construction/projects/application/project.service.ts:241`
  → `await this.assertMember(prisma, projectId, identity.userId);`
- `assertMember` throws `403 You are not a member of this project.` (line 275–280)

But `ProjectService.create` (line 70–82) never enrols the creator as a member, and
`ProjectPrismaRepository.create` only inserts the `Project` row.

**Result:** every `POST /projects/:id/members` returns `403`, for every user, forever.
A project's member list is permanently empty and unreachable through any API path.
There is no workaround from the client.

**What the frontend needs — either:**

1. `create` auto-enrols the creator as a member with `PROJECT_MANAGER`, or
2. `addMember` permits a non-member caller holding an appropriate org-level role.

Option 1 also gives the project an owner, which the UI needs for the detail header.
This is a decision about the domain model, so it may be worth confirming with Eng Ahmed
which roles may enrol members.

**Frontend impact:** the Projects members tab is deferred until this lands.

---

### <a id="b2"></a>B2 — No endpoint lists users in an organization

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Blocking (depends on B1 being fixed to matter).

`apps/api/src/platform/users/presentation/users.controller.ts` exposes only
`GET /users/:id`. `POST /projects/:id/members` requires a `userId`, and the frontend
has no way to discover one — you cannot type a CUID into a picker.

**What the frontend needs:** `GET /users` scoped to the caller's organization from the
token (not a query param — see B5).

Questions that shape the UI, worth deciding when the endpoint is designed:

- Paginated, or is a full org list acceptable at ACCO's size?
- Server-side search by name/email, or client-side filter?
- Can it exclude users already on a given project (`?notInProject=<id>`)? This is the
  difference between a clean picker and one that lists people then errors with `409`.

---

### <a id="b3"></a>B3 — `GET /workflows/definition/:transactionType` requires a request body

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Blocking for any workflow UI.

`apps/api/src/platform/workflows/presentation/workflows.controller.ts:38`

```ts
@Get('definition/:transactionType')
getDefinition(
  @Param('transactionType') transactionType: WorkflowTransactionType,
  @Body('organizationId') organizationId: string,   // ← body on a GET
)
```

The Fetch standard forbids a body on `GET`; `fetch()` throws before sending. `XMLHttpRequest`
and most HTTP clients drop it. This endpoint cannot be called from a browser at all.

**What the frontend needs:** derive `organizationId` from the token
(`identity.activeOrganizationId`), consistent with every Projects endpoint.
Failing that, a query parameter — but the token is the correct source.

---

### <a id="b14"></a>B14 — `POST .../nodes/:id/move` always fails, and leaves the tree corrupted

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Blocking. Reproduced against the running API; two defects in one function.

`BoqPrismaRepository.moveNode` (`boq-prisma.repository.ts:127–151`) runs two raw statements.

**Defect 1 — every call errors.** Step 2 interpolates a JS number as the substring offset:

```ts
// boq-prisma.repository.ts:145
SET "path" = ${newNodePath} || '/' || substring("path", ${oldPath.length + 2}),
```

Prisma binds that number as `bigint`, and PostgreSQL has no `substring(text, bigint)`:

```
Raw query failed. Code: 42883.
ERROR: function substring(text, bigint) does not exist
```

Every move answers `500`, whatever the node.

**Defect 2 — the failure half-applies.** The two statements are not wrapped in a
transaction, so step 1 has already committed when step 2 throws. Verified directly:

```
before:  A sort_order=1,  B sort_order=2
POST .../nodes/B/move  {"newParentId": S, "newSortOrder": 1}   → 500
after:   A sort_order=1,  B sort_order=1     ← written despite the error
```

For a node with descendants this is worse than a failed write: the moved node's `path` and
`depth` are updated while its descendants keep the old prefix, so the materialized-path
index no longer describes the tree. Every `path LIKE 'oldPath/%'` query — including the
next move and the subtree copy performed when a draft is created — then reads a tree that
does not match reality.

**Suggested fix:**

1. Cast the offset, e.g. `substring("path", ${oldPath.length + 2}::int)`, or pass it as
   `Prisma.raw(String(n))`.
2. Wrap both statements in `prisma.$transaction` so a failure cannot half-apply.
3. Consider a regression test that moves a node **with children** and asserts every
   descendant path was rewritten — defect 2 is invisible on a leaf.

**Frontend impact:** the reorder controls are written and tested but not rendered
(`REORDER_ENABLED = false` in `apps/web/src/features/boq/node-actions.ts`). Shipping a
button that corrupts the BOQ is worse than shipping no button. Flipping that flag is the
whole re-enable once this lands.

---

## Security

### <a id="b4"></a>B4 — Approver identity is supplied by the client

> *Verified live at `c8afdd6` (2026-08-04).*

`workflows.controller.ts` — `approve` and `reject` both read the actor from the body:

```ts
@Body() body: { actorId: string; notes?: string }
```

Any authenticated user can approve as any other user by changing one field. `AGENTS.md`
requires approval workflows to be enforced server-side and never trust client-side
approval state; `apps/api/CLAUDE.md` says the same.

**What the frontend needs:** `actorId` derived from the JWT via `@CurrentUser()`.
The frontend will not send an `actorId`. Until this changes, no approval UI will be built.

---

### <a id="b5"></a>B5 — `orgId` taken from the query string

> *Roles half verified live at `c8afdd6` (2026-08-04) — tracked as
> [#16](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/16).
> Audit-log half **fixed** in `776b695`.*

This finding originally covered two endpoints. Only one of them still stands.

**Still live — roles:**

- `apps/api/src/platform/roles/presentation/roles.controller.ts:18` — `findAll(@Query('orgId') orgId: string)`,
  passed straight through by `roles.service.ts:13` with no comparison to
  `identity.activeOrganizationId`.

**Fixed — audit logs.** `AuditLogsController.findByOrg` now takes `@CurrentUser() identity`
and passes `identity.activeOrganizationId`; the query parameter is gone. This was the more
serious of the two, and it was resolved in `776b695` — the commit whose message lists
"B5" among the findings it addresses. The roles half was not included in that fix.

A tenant database can hold multiple organizations, so while `/roles` remains unscoped, a
user can still read another organization's role definitions by changing a query parameter.

**What the frontend needs:** `/roles` should scope to the token's organization and drop the
parameter, as `/audit-logs` now does. The frontend will not pass `orgId`.

---

### <a id="b11"></a>B11 — BOQ version endpoints skip the organization check

> *Verified live at `c8afdd6` (2026-08-04).*

`BoqTreeService.requireBoqForProject` does verify ownership:

```ts
// boq-tree.service.ts:216
if (boq.organizationId !== organizationId) throw new ForbiddenException();
```

`BoqVersioningService` does not. Its `requireBoq` / `getBoq` call
`repo.findByProject(prisma, projectId)` (`boq-prisma.repository.ts:12`), which filters on
`projectId` alone with no organization predicate. This affects `getBoq`, `initialize`,
`createDraftFromApproved`, `baseline`, and `cancelDraft`.

**Result:** within a tenant, a user in org A can read another org's BOQ and its version
history, baseline its draft, or cancel it. `initialize` is worse — it creates a `Boq` row
stamped with the *caller's* `organizationId` against another org's `projectId`.

**What the frontend needs:** the same ownership check the tree service already performs.
This one is independent of the frontend — it should be fixed regardless of UI plans.

---

### <a id="b15"></a>B15 — `GET /workflows/instance/:id/step` is not organization-scoped

**Security · verified at `4a895e7` (2026-08-11)**

Every other handler on `WorkflowsController` takes `@CurrentUser() identity` and uses it —
`getDefinition` scopes by `identity.activeOrganizationId`, `approve` and `reject` pass
`identity.userId` (that was B4's fix). `getCurrentStep` takes neither:

```ts
// workflows.controller.ts:41
getCurrentStep(@Param('instanceId') instanceId: string) {
  return this.approvalService.getCurrentStep(instanceId);
}
```

The instance ID goes straight through with no ownership check, so a caller holding any valid
JWT can read the pending approval step — approver identity, step order, document reference —
of any `ApprovalInstance` in any tenant. This is the same defect as B5 and B11, both of which
were found in the Sprint 1–2 sweep and fixed.

The exposure is currently limited by discoverability rather than by any guard: instance IDs are
cuids, and the only place one surfaces is the `approvalInstanceId` scalar on a `MaterialRequest`
or `PurchaseOrder` payload, which is itself org-scoped. That is not a control, and it stops
being even a mitigation the moment an instance ID appears in a URL or a log.

**Frontend impact:** none today — nothing calls this endpoint. It is raised now because the
per-document approval panel would be its first consumer, and the guard should land before that
rather than after.

---

## Contract & correctness

### <a id="b6"></a>B6 — Undocumented empty response bodies

> **PARTIALLY RESOLVED 2026-08-14 (ADR-016).** The two BOQ rows are closed: `move` now
> returns the reindexed tree, and `DELETE` documents its `409` reference payload. Other
> modules in the table remain open.

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

These return `200` with **no body**, because the service method returns `void`:

| Endpoint | Source |
|---|---|
| `POST /projects/:id/suspend` | `project.service.ts:171` |
| `POST /projects/:id/resume` | `project.service.ts:189` |
| `DELETE /projects/:id/members/:userId` | `project.service.ts:225` |
| `POST /auth/logout` | `auth.controller.ts:60` |
| `POST …/nodes/:nodeId/move` | `boq-tree.service.ts:144` |
| `DELETE …/nodes/:nodeId` | `boq-tree.service.ts:184` |

`api-reference.md` documents response shapes for the six lifecycle transitions and for
cancel — all correct — but says nothing about the response of these six. A client that
assumes JSON (as ours did) throws on `res.json()`.

**Two requests, in preference order:**

1. Return the updated resource (project / BOQ tree), so the UI can update without a
   second round-trip. This is what the lifecycle transitions already do, and consistency
   here is worth more than the saved bytes.
2. If an empty body is intentional, return `204 No Content` rather than `200`, and
   document it.

The frontend now handles empty bodies defensively either way, so this is not blocking.

---

### <a id="b7"></a>B7 — Money totals computed in floating point

> **RESOLVED 2026-08-14 (ADR-016, CONST-BOQ-014).** `domain/boq-money.ts` does every
> multiplication and sum in `Prisma.Decimal`; `computedTotal` and `totalAmount` both leave
> as decimal strings. Covered by `__tests__/boq-tree.spec.ts` ("computes line and section
> totals in decimal, not floating point").

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`boq-tree.service.ts:254`

```ts
return Math.round(quantity * unitRate * 100) / 100;
```

and `:265` / `:284–292`, where `totalAmount` (a Prisma `Decimal`) is converted with
`Number()` and accumulated into `computedTotal` as a JS `double`.

Decimal columns are being summed as binary floating point. At ACCO's contract values
(~1e8, 2dp) this stays within `double` precision, so it is not currently producing wrong
numbers — but it is a correctness landmine as values grow or as more arithmetic is layered
on, and it undercuts the reason the columns are `Decimal` in the first place.

**Suggested:** use `Prisma.Decimal` arithmetic and serialize the total as a string, like
every other money field. The frontend does no money arithmetic (all totals come from
`computedTotal`), so a string is the preferred shape — it is also more consistent, since
`totalAmount` is already a string while `computedTotal` is a number.

---

## Gaps (non-blocking)

### <a id="b8"></a>B8 — `GET /projects` has no pagination, search, or sort

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`project-prisma.repository.ts:22` — `findMany` with an optional status filter and
`orderBy: { createdAt: 'desc' }`. No `skip`/`take`, no text search.

Fine at ACCO's current scale. The frontend fetches the full list and filters client-side,
which is a deliberate, documented trade-off — not an oversight. It will need revisiting
before the list reaches a few hundred projects.

### <a id="b9"></a>B9 — No way to persist a language preference

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`User.preferredLanguage` populates the JWT `lang` claim, and the frontend now seeds the UI
language from it. But there is no `PATCH /users/:id` (or `/users/me`), so when a user
switches language the change is device-local and lost on the next device.

**What the frontend needs:** an endpoint to update the current user's `preferredLanguage`.

### <a id="b10"></a>B10 — No summary/aggregate endpoint

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

The dashboard shows project counts by status, computed client-side from the full
`GET /projects` response. A `GET /projects/summary` returning counts per status would
remove that, and becomes necessary once B8 does.

Not urgent — raised so it is on the roadmap rather than discovered later.

### <a id="b13"></a>B13 — `move` never reindexes siblings, so positions can tie

> **RESOLVED 2026-08-14 (ADR-016, CONST-BOQ-017).** `moveNode` now runs one interactive
> transaction that parks the node, compacts the source range, opens a gap at the destination
> and rewrites the subtree via a recursive CTE. `@@unique([versionId, parentId, sortOrder])`
> plus a partial unique index for root nodes make a tie unstorable. Reorder can be enabled
> in the UI.

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open, with one correction to the finding: `sortOrder` is **not** required on create. `schema.prisma:536` declares `Int @default(0)`, so an omitted value ties at 0 rather than being rejected — ties are easier to produce than recorded, not harder. `moveNode` still writes the moved node alone (`boq-prisma.repository.ts:109`) and there is still no unique constraint on `(version_id, parent_id, sort_order)`.*

`sortOrder` is required on create and the API never allocates one, while `moveNode` writes
the given position onto the moved node alone and leaves its siblings untouched. Nothing
prevents two siblings from holding the same `sortOrder`, and
`findNodesByVersion` orders by `[depth, sortOrder]` — so tied siblings come back in an
order PostgreSQL does not guarantee and which can change between reads.

The frontend avoids creating ties: new nodes take `max(sibling.sortOrder) + 1`, and
reordering is expressed as a two-node swap rather than a renumber. That keeps our own
writes clean but cannot repair ties introduced elsewhere.

**Suggested:** either reindex the destination siblings inside the move (and inside create),
or add a partial unique index on `(version_id, parent_id, sort_order)` so a tie is rejected
rather than silently stored. Lower priority than B14, but the two are worth fixing
together since both live in `moveNode`.

### <a id="b12"></a>B12 — `@erp/types` exports no Project DTO

> **RESOLVED for BOQ 2026-08-14 (ADR-016).** `packages/types/src/construction.ts` now
> exports `BoqResponse`, `BoqVersionResponse`, `BoqTreeNodeResponse`,
> `BoqBaselineReadinessResponse`, `BoqWorkspaceResponse` and `BoqCompareResponse`. The
> Project/ProjectMember half of this entry is still open.

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`apps/web/CLAUDE.md:170` instructs the frontend to import shared types and never redefine
them locally — the right rule, and one we want to follow. But `packages/types` exports the
`ProjectStatus`, `ProjectRole` and `BoqVersionStatus` enums with no accompanying record
shapes, and `packages/types` is backend-owned.

So `apps/web/src/features/projects/types.ts` declares the `Project` wire shape locally,
with a comment pointing here. That file is now a second definition of a backend contract
and will drift the first time a column is added.

**What the frontend needs:** DTOs in `@erp/types` for the shapes the API actually returns,
starting with `Project`, then `ProjectMember`, `Boq`, `BoqVersion` and `BoqTreeNode`.

Two details that matter for the DTO to be usable as-is:

- `Decimal` columns serialize as **strings** (`contractValue: "4500000.00"`), not numbers.
  The DTO should say `string`, matching the wire format rather than the Prisma type.
- `DateTime` columns serialize as ISO strings, not `Date` objects. Note that the existing
  `UserDto` and `OrganizationDto` declare `createdAt: Date`, which is wrong for anything
  that has been through `JSON.parse` — worth correcting at the same time.

---

## Sprint 3 — commercial modules

Raised before building the Contracts → IPA → IPC → Receipts UI. Credit where it is due
first: these modules are noticeably more disciplined than the Sprint 1 platform code.
Every controller derives identity from `@CurrentUser()`, `IpaService.addItem` computes
`previousEffectiveCertified`, `periodQuantity` and `periodAmount` server-side in `Decimal`,
`IpcService.findOne` returns `netCertified` as a decimal string, and receipt allocation is
properly guarded against over-allocation. The findings below are concentrated in two
places: what `POST /ipc` accepts, and what it does not check.

### <a id="c2"></a>C2 — `POST /ipc` validates nothing about the application it certifies

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Security. Same class as B11, and the highest-priority item in this section.

`IpcService.issue` (`ipc.service.ts:51`) takes `dto.applicationId` and uses it directly.
It never loads the IPA. There is no organization check, no status check, and no check that
the items being certified belong to that application:

```ts
// ipc.service.ts:57 — looked up by id alone
const appItem = await prisma.interimPaymentApplicationItem.findUnique({
  where: { id: item.applicationItemId },
  select: { cumulativeClaimed: true, unitRateSnapshot: true },
});
```

Three consequences, in order of severity:

1. A user in org A can issue a certificate against org B's application. The certificate is
   stamped with the *caller's* `organizationId` — the same shape of defect as B11's
   `initialize`.
2. A certificate can be issued against a `DRAFT` application that was never submitted,
   bypassing the entire IPA approval sequence.
3. `applicationItemId` is never checked against `dto.applicationId`, so a certificate can
   certify line items belonging to a different application entirely — and it will price
   them using *that* application's `unitRateSnapshot`.

Every sibling service does this correctly: `ContractService`, `IpaService` and
`FinanceService` all call a `requireX(prisma, identity.activeOrganizationId, id)` helper
first. `IpcService` is the one that does not.

**What the frontend needs:** the same `requireIpa(identity.activeOrganizationId, …)` guard
its siblings use, a status check that the IPA is `SUBMITTED`, and an
`applicationItem.applicationId === dto.applicationId` assertion.

This one should be fixed regardless of any UI plans.

---

### <a id="c3"></a>C3 — Unit rate is taken from the request, not the contractual BOQ

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Security / correctness.

`AddIpaItemDto` requires the client to send `unitRateSnapshot`, and `IpaService.addItem`
stores it verbatim. Nothing compares it to the BOQ node's `unitRate`.

The service is already reading that exact row one line earlier:

```ts
// ipa.service.ts:150 — the node is loaded, but only for measurementMethod
const boqNode = await prisma.boqNode.findUnique({
  where: { id: dto.boqNodeId },
  select: { measurementMethod: true },
});
```

So any authenticated user can claim any quantity at any price they choose, and the field
named "snapshot" records the client's number rather than the contract's. `periodAmount` is
then computed from it server-side, which lends a fabricated rate the appearance of a
server-derived total.

**What the frontend needs:** add `unitRate` and `currency` to that `select` and take both
from the node. The frontend will stop sending `unitRateSnapshot` once it does.

Note this also silently ignores the contract's `boqVersionId`: an item can reference a BOQ
node from any version, including a draft one, rather than the baselined version the
contract is bound to.

---

### <a id="c1"></a>C1 — Retention and advance-recovery arithmetic is delegated to the browser

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Blocking for the IPC issuance UI. This is a design question, not a bug.

`CreateIpcDto` requires the client to compute and send:

- `certifiedTotal` — the gross certified amount
- for every deduction: `deductionType`, `rate`, `basis` and `amount`

`IpcService.issue` recomputes each item's `certifiedAmount` from the application item's
`unitRateSnapshot` — correctly, in `Decimal` — but stores `certifiedTotal` and every
deduction amount exactly as received, with no cross-check against the item sum it just
calculated. `IpcDetail` then returns both numbers, which can disagree.

The backend holds everything needed to derive these itself: `ContractRetentionTerms`
(`retentionRate`, `retentionCap`, `retentionSplitOnPC`) and `ContractAdvanceTerm`
(`recoveryRate`) hang off the contract that owns the application.

`apps/web/CLAUDE.md:347` says a wrong retention calculation costs real money for real
people. This API asks the frontend to own that calculation, and `apps/api/CLAUDE.md` is
explicit that financial derivation belongs server-side.

**What the frontend needs — in preference order:**

1. The API derives `certifiedTotal` from the certified items, and derives retention and
   advance-recovery deductions from the contract terms. The client sends certified
   quantities and variance reasons only — the two things a human actually decides.
2. Failing that, the API validates what it is sent: reject a `certifiedTotal` that does not
   equal the item sum, and a retention `amount` that does not match `basis × retentionRate`.
   The arithmetic still happens in the browser, but a mistake cannot be persisted.

**Frontend impact:** the IPC issuance UI is sequenced last and will not be built until this
is settled. Certificate *viewing* and supersession do not depend on it and will ship first.
Manual deductions the user genuinely authors — an ad-hoc contra charge, for instance —
should stay client-supplied under either option.

---

### <a id="c7"></a>C7 — A fully-settled certificate can never report `PAID`

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Correctness. A bug in shipped code.

`getCertificatePaymentSummary` (`finance-prisma.repository.ts:71–94`) compares total
allocations against the certificate's **gross** `certifiedTotal`:

```ts
const certTotal = Number(cert?.certifiedTotal ?? 0);   // gross, before deductions
const totalAllocated = Number(alloc._sum.allocatedAmount ?? 0);
if (totalAllocated >= certTotal) status = 'PAID';
else if (totalAllocated > 0) status = 'PARTIALLY_PAID';
```

But a client pays the **net** — `certifiedTotal` minus retention, advance recovery and tax.
`IpcService.findOne` already computes and returns exactly that figure as `netCertified`.

So for any certificate carrying a deduction — which is every certificate on a contract with
retention terms — allocations can only ever sum to the net, the comparison never succeeds,
and the status is pinned at `PARTIALLY_PAID` forever. A 5% retention makes `PAID`
unreachable. The only certificates that can reach `PAID` are those with no deductions at
all.

**Suggested fix:** compare against net certified, computed the same way `findOne` does.
Worth a regression test asserting that a receipt equal to `netCertified` yields `PAID` on a
certificate that carries a retention deduction.

**Frontend impact:** the Receipts UI will show allocation amounts and remaining balance,
which are trustworthy, but will not present this endpoint's `status` as settlement truth
until it is fixed. Showing "partially paid" on a fully-paid certificate is the kind of
plausible wrong number that gets a finance officer to stop trusting the system.

---

### <a id="c4"></a>C4 — No guard against over-claiming or a negative period quantity

> *Verified live at `c8afdd6` (2026-08-04). Over-claiming half tracked as
> [#19](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/19); the negative-quantity half
> is **not** ticketed — it is a domain question, see [D4](#d4).*

**Severity:** Correctness — and partly a domain question (see D4).

This finding has two halves and only one of them was filed. Over-claiming past the
contracted BOQ quantity is a defect under any domain answer, so it went to #19 on its own.
Whether a claim may go *below* what was already certified is a question for Eng Ahmed
rather than a bug, so it stays here and in `domain-questions.md` until answered.

`IpaService.addItem` computes `periodQuantity = cumulativeClaimed − previousEffectiveCertified`
and stores it without constraining either side. Nothing checks:

- `cumulativeClaimed` against the BOQ node's `quantity` — a line can be claimed well beyond
  the contracted quantity with no warning;
- that `cumulativeClaimed ≥ previousEffectiveCertified` — a lower figure yields a negative
  `periodQuantity` and a negative `periodAmount`, silently.

The negative case may well be legitimate — a claw-back after an over-certification is
normal on measured contracts — which is why this needs a domain answer before the UI
decides whether to block it, warn on it, or accept it silently. Over-claiming past the BOQ
quantity is harder to justify and is likely a data-entry error worth rejecting.

**What the frontend needs:** a decision on each case (see D4), then whatever validation
follows from it. The form will mirror the server's rule rather than invent its own.

---

### <a id="c5"></a>C5 — Workflow policy is resolved but no approval instance is created

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — unchanged, and still no action needed. `ipa.service.ts:100` carries the comment that approval-instance creation is Sprint 4+ work.*

**Severity:** Contract clarity. Not a defect — the behaviour is deliberate and commented.

`IpaService.transition` (`ipa.service.ts:99`) resolves the `WorkflowRequirementPolicy` for
`submit-for-approval` and `return-for-revision`, then changes the status directly:

```ts
// Enforce WorkflowRequirementPolicy. Resolver throws 422 if REQUIRED and no binding configured.
// When a binding is found, transition proceeds — approval instance creation is Sprint 4+ work.
```

This is genuinely good news for the frontend: it means IPA lifecycle UI can be built now
without waiting on B3 and B4, which is what unblocked this phase.

Recording it because it changes what the buttons *mean* later. Today `approve-for-submission`
approves. Once approval instances exist, `submit-for-approval` will produce a pending
instance and approval will move to a different actor and a different screen.

**What the frontend is doing about it:** lifecycle controls are built on one shared module
(`getAvailableActions` + `useLifecycleCommand`) so the change lands in one place rather than
across three detail screens. No further backend action needed — please just flag it on the
ADR when the approval instance work is scheduled.

---

### <a id="c6"></a>C6 — Shared DTOs shipped, but 13 of 16 do not match the API

> *Re-verified 2026-08-04 against `c8afdd6`. Tracked as
> [#21](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/21).*

`packages/types/src/construction.ts`, added in `776b695`, exports response DTOs for all five
Sprint 3 aggregates. That is the shape of what C6 asked for, and for half a day this entry
recorded C6 as resolved on that basis.

It is not resolved. Compared field by field against `apps/api/prisma/schema.prisma` and the
service return shapes, **13 of the 16 interfaces are wrong** — inventing fields that do not
exist, omitting fields the API returns, or renaming them. The full table is in
[#21](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/21).

Only `IpaResponse`, `IpcItemResponse` and `IpcDeductionResponse` are safe to adopt.

The worst is `IpcPaymentStatusResponse`, wrong in all five of its fields: the endpoint
returns `{ totalAllocated: number, status }` and the DTO declares `certificateId`,
`certifiedTotal`, `outstanding`, `paymentStatus` and a `string` `totalAllocated`.

**What this means for the frontend:**

1. `apps/web/src/lib/api-types.ts` stays. It was read off the schema and the repository
   `include` clauses and is correct everywhere the two disagree. It cannot be deleted in any
   case while **B12** is open, since Project and BOQ have no shared DTO at all.
2. Migrating to `@erp/types` is not merely unhelpful right now, it is a hazard. The receipts
   UI reads `allocatedAt` and `allocatedBy`; neither exists on `ReceiptAllocationResponse`.
   A good-faith "align to shared types" change would type-check and break the allocations
   panel.

**The durable fix is still the one this entry originally asked for:** every `@ApiResponse` is
`{ status, description }` with no `type:`, so `/docs-json` says nothing about responses.
Adding `type:` would let response types be generated from the live spec instead of
hand-authored, which is what produced these 13 discrepancies and will produce more.

**Still worth doing, and unchanged by the above:** every `@ApiResponse` is
`{ status, description }` with no `type:`, so `/docs-json` describes request bodies
accurately and says nothing about responses. Adding `type:` to the response decorators
would let the frontend generate response types from the live spec rather than hand-mirroring
them, and would keep B12 from recurring for the next aggregate.

---

### <a id="c8"></a>C8 — `totalAllocated` returns a number, breaking the money-as-string rule

> *Verified live at `c8afdd6` (2026-08-04).*

`getCertificatePaymentSummary` returns `totalAllocated` as a JS number via `Number()`
(`finance-prisma.repository.ts:86–87`), and `getTotalAllocated` (`:44–48`) does the same
before using it in the over-allocation guard.

Every other money field on the API is a decimal string. This is the same class as B7 —
`Decimal` columns summed in binary floating point — and it means the over-allocation check
at `finance.service.ts:65` is itself performed in floating point, on the value that decides
whether a payment is accepted.

**Suggested:** keep the sum in `Prisma.Decimal` and serialize as a string, consistent with
`netCertified` and every other money field.

---

### <a id="c9"></a>C9 — `measurementMethod` and `pricingBasis` can never be set

> **RESOLVED 2026-08-14 (ADR-016).** `CreateNodeDto` / `UpdateNodeDto` accept both fields,
> and `copyNodes` carries them into a revision — it used to drop them, silently resetting an
> inherited lump-sum item to QUANTITY / UNIT_RATE.

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

The roadmap lists "BOQ node extensions (measurementMethod, pricingBasis)" as delivered in
Sprint 3 Phase 1, and the columns do exist on `BoqNode` with defaults `QUANTITY` and
`UNIT_RATE`. Both are returned by the tree endpoint.

But **no DTO accepts either field**. `CreateNodeDto` and `UpdateNodeDto` declare neither,
and `BoqTreeService` never writes them. With `forbidNonWhitelisted: true`, sending one is a
`400`. So every BOQ node in the system is permanently `QUANTITY` / `UNIT_RATE`, and a
lump-sum or milestone-billed line cannot be expressed at all.

This matters downstream: `IpaService.addItem` snapshots `measurementMethod` onto every
claimed line (`ipa.service.ts:150`), so the snapshot is currently always the default. The
IPA item picker will label every line "quantity" regardless of what it really is.

**What the frontend needs:** both fields accepted on create and on update, so a lump-sum
line can be entered. Until then the BOQ editor will not offer the choice — an input that
silently has no effect is worse than no input.

---

### <a id="c10"></a>C10 — Retention split is spelled `…OnPc` going in and `…OnPC` coming out

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`AddRetentionTermsDto` declares `retentionSplitOnPc`. The Prisma column is
`retentionSplitOnPC`, and `upsertRetentionTerms`
(`contract-prisma.repository.ts:105–130`) translates between the two.

Nothing is broken server-side, but the request and response shapes for this one field
differ by a single letter's case. Combined with `forbidNonWhitelisted: true`, reading a
contract and posting its retention terms back — the obvious way to write an edit form —
returns:

```
property retentionSplitOnPC should not exist; retentionSplitOnPc is not a valid decimal number.
```

Found by running the seed script against the live API, not by reading the code, which is
roughly how a frontend engineer would find it at 6pm on a Friday.

**Suggested:** rename the DTO field to `retentionSplitOnPC` so request and response agree.
It is a one-word change in a Sprint 3 DTO that no client depends on yet.

---

### <a id="c13"></a>C13 — Cancel and terminate require a reason and discard it

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`CancelContractDto` and `TerminateContractDto` both mark `reason` `@IsNotEmpty()` with a
500-character limit, so the client must supply one. `ContractService` then throws it away:

```ts
// contract.service.ts:144 and :158
void reason; // audit trail deferred to Phase 4 AuditLog
```

No column on `Contract` holds it, so the explanation for ending a contract early exists
nowhere after the request completes. The deferral is deliberate and commented — this is
raised because of what it means for the UI, not because it looks accidental.

Terminating a live construction contract is a legally significant act, and "why" is the
part that matters six months later. Projects already do this properly: a suspension reason
is persisted on `ProjectSuspension`.

**What the frontend does meanwhile:** the confirmation dialogs collect the reason, because
the API rejects the request without it, and say plainly that it is not stored yet rather
than implying an audit trail that does not exist.

---

### <a id="c14"></a>C14 — `RETURNED_FOR_REVISION` is a dead end

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Blocking for the IPA revision loop. Reproduced against the running API.

`TRANSITIONS['submit-for-approval']` accepts `DRAFT` and nothing else
(`ipa.service.ts:18`), so an application that has been returned for revision can never be
resubmitted:

```
POST /ipa/:id/submit-for-approval
→ 400 "Cannot 'submit-for-approval' an IPA with status 'RETURNED_FOR_REVISION'.
       Expected 'DRAFT'."
```

The state is not merely a gap, it is a trap, because the two halves disagree:

- `MUTABLE_STATUSES` **includes** `RETURNED_FOR_REVISION` (`ipa.service.ts:30`), so items
  and deductions can be added and removed. The reviewer's feedback can be acted on.
- No transition leaves the state except `cancel`.

So a quantity surveyor can be told what to fix, fix it, and then discover the corrected
application cannot go anywhere. The only exit is to cancel and re-enter the whole claim on
a new application — losing the line history that was just corrected.

The name of the transition says what was intended: an application is *returned for
revision* so that it can be revised and come back.

**Suggested fix:** accept `RETURNED_FOR_REVISION` as a second source state for
`submit-for-approval`:

```ts
'submit-for-approval': ['DRAFT', 'RETURNED_FOR_REVISION'],
```

Worth a regression test that walks the full loop — submit, return, edit, resubmit, approve
— since the forward path passes today while the loop does not.

**Frontend impact:** the detail screen shows the full set of line controls in this state,
because the API genuinely allows editing, and an explanation that the result cannot be
submitted. That is the honest presentation of the current behaviour, and it is a bad
screen — it should stop being needed rather than be designed around.

---

### <a id="c15"></a>C15 — Claimed items carry a bare `boqNodeId`

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`GET /ipa/:id` returns each `InterimPaymentApplicationItem` with a `boqNodeId` and nothing
that describes it — no `code`, no `description`. `IpaPrismaRepository.findById` includes
`items: true` with no relation expansion, and `BoqNode` is never joined.

So a claimed-lines table built from that response alone can only show an opaque cuid. The
frontend fetches the BOQ tree for the contract's version and joins client-side, which is
affordable here because the line picker needs the tree anyway — but every other consumer
will have to repeat it, and a printed or exported application would too.

**Suggested:** expand the node on the item, or denormalise `code` and `description` onto
the item at creation, the way `measurementMethodSnapshot` and `unitRateSnapshot` already
are. The snapshot argument is stronger here than for most fields: a BOQ line's description
can be reworded in a later version, and a submitted application should keep the wording it
was actually claimed under.

---

### <a id="c17"></a>C17 — A negative allocation is accepted and defeats the over-allocation guard

> *Verified live at `c8afdd6` (2026-08-04).*

**Severity:** Correctness. A bug in shipped code, reproduced against the running API.

`AllocateReceiptDto.allocatedAmount` is `@IsDecimal()`, which accepts `"-100.00"`, and
`FinanceService.allocate` guards only the UPPER bound:

```ts
// finance.service.ts:65
if (afterAllocation.greaterThan(receiptAmount)) { throw ... }
```

So a negative allocation passes, and because it is summed into `getTotalAllocated`, it
INCREASES the headroom available to later allocations.

**Reproduced on a 1,000.00 receipt:**

```
allocate  1500.00  → rejected, correctly
allocate  -100.00  → ACCEPTED
allocate   600.00  → accepted
allocate   500.00  → accepted   (600 + 500 = 1100, under the cap only because of the -100)
```

The receipt then reports a total of exactly 1,000.00 and looks fully settled, while holding
a line that means nothing.

**It also persists.** Deleting the negative allocation afterwards leaves the receipt with
**1,100.00 allocated against 1,000.00**, because the guard runs only on insert and nothing
re-checks the invariant on removal. Verified — that is the state the dev database is in
now.

**Suggested fix:**

1. Reject a non-positive `allocatedAmount` — `@IsPositive()` alongside `@IsDecimal()`, or an
   explicit check in the service.
2. Re-assert the invariant on `removeAllocation`, or make the guard a database constraint,
   so an over-allocated receipt cannot survive a delete.

Worth a regression test for the sequence above rather than for a single over-allocation:
the simple case already passes today.

**What the frontend does meanwhile:** `allocationProblem` rejects empty, non-numeric, zero
and negative amounts as well as anything over the remaining balance, so the UI cannot
create this state. It cannot repair a receipt that already holds it.

---

### <a id="c16"></a>C16 — No way to list or attribute certificates by client

> *Verified live at `c8afdd6` (2026-08-04).*

`GET /ipc` filters on `applicationId` alone, and a certificate row carries nothing else
identifying — no client, no contract, no project. So answering "which certificates can this
client's payment be allocated against?" means walking

```
certificate → application → contract → client
```

with three unfiltered list calls (`GET /ipc`, `GET /ipa`, `GET /contracts`) and a
client-side join. That is what the allocation picker does today; it is affordable at ACCO's
size and will not stay that way.

The same gap makes the allocation itself unguarded: `FinanceService.allocate` checks that
the certificate belongs to the caller's ORGANIZATION but not that it belongs to the
RECEIPT'S CLIENT, so client A's payment can be allocated against client B's certificate.
Nor is currency checked — a USD receipt allocates against a SOS certificate without
complaint.

**What the frontend needs, in preference order:**

1. `GET /ipc?clientId=` — or a `contractId`/`projectId` filter, from which a client filter
   follows.
2. Expansion of the owning contract and client on the certificate row, so a certificate can
   be labelled without two more round-trips.
3. A server-side check that the certificate and the receipt share a client, and a warning
   or rejection when their currencies differ.

The picker restricts choices to the receipt's own client and flags a currency mismatch, so
our calls are correct — but nothing stops another client from getting it wrong.

---

## Domain questions — for Eng Ahmed Shirie

### <a id="d1"></a>D1 — Mixed-currency BOQ nodes sum into one meaningless total

> **RESOLVED 2026-08-14 (ADR-016, CONST-BOQ-013).** A BOQ has one currency, seeded from the
> project at initialization. A node presenting any other currency is rejected, so aggregate
> totals are always meaningful. The frontend's mixed-currency suppression is retired.

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`currency` is an optional field on each individual BOQ node
(`create-node.dto.ts`, `@IsOptional() @Length(3,3)`). Nothing constrains sibling nodes to
share a currency, and `BoqTreeService.sumTotals` (`boq-tree.service.ts:284`) adds
`computedTotal` across children without inspecting currency at all.

A BOQ containing a USD leaf and a SAR leaf produces a parent total that is arithmetically
the sum of two different currencies, and the UI would display it with a single currency
symbol — confidently wrong, in a document used for contract valuation.

**Questions:**

1. Can a single BOQ ever legitimately hold more than one currency? (Split FX contracts and
   imported-materials packages are the cases I'd expect, but I don't know ACCO's practice.)
2. If not — should currency live on the Project or the BOQ rather than the node, so it
   cannot diverge?
3. If yes — what should a parent total show?

The frontend will not display parent totals for mixed-currency subtrees until this is
settled. Showing a plausible wrong number is worse than showing none.

---

### <a id="d4"></a>D4 — Can a payment application claim less than was already certified?

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

Context for C4. An IPA line carries `cumulativeClaimed` — the total claimed to date, not
this period — and the server derives the period figure by subtracting what the last
effective certificate certified. Neither side is currently constrained.

**Questions:**

1. Can `cumulativeClaimed` legitimately be *lower* than `previousEffectiveCertified`,
   producing a negative period amount? My assumption is yes — a claw-back after an
   over-certification is normal on measured contracts — but I would rather not assume it.
2. Should a claim be allowed to exceed the BOQ line's contracted quantity? Variations are
   the usual answer, and this platform has no variation module yet, so I expect the answer
   is "reject it for now" — but that decision belongs to you, not to me.
3. If over-claiming is allowed, should the UI warn, require a note, or stay silent?

This decides whether the IPA item form blocks the entry, warns and continues, or accepts it
without comment. The form will implement whatever the API enforces — the request here is
for the rule, not for UI advice.

---

## Documentation

### <a id="d2"></a>D2 — `api-reference.md` gaps

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`docs/reference/api-reference.md` is genuinely good and was the fastest way to get
oriented. Three corrections:

1. **§5.8 Suspend/Resume, §5.9 move/delete** — response bodies are not documented and are
   empty. See B6.
2. **§5.4 Roles** — the required `?orgId=` query parameter is not shown in the endpoint
   table. A request without it currently returns an empty result rather than an error,
   which is a confusing failure mode. Note this documentation gap disappears if B5 is
   fixed as asked, since the parameter goes away with it.
   **§5.6 Audit Logs** no longer applies — `/audit-logs` was fixed in `776b695` and takes
   no parameter. The endpoint table is now correct for it; only the roles row is wrong.
3. **§5.7 Workflows** — the `GET definition` entry does not mention the required
   `organizationId`, which is in the request body. See B3.

---

### <a id="d3"></a>D3 — Documented request shapes that return `400`

> *Verified live at `c8afdd6` (2026-08-04).*

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

These matter more than ordinary doc drift, because the global `ValidationPipe` runs with
`forbidNonWhitelisted: true` (`main.ts:18–23`). An unrecognised field is not ignored — it
is a `400`. So a documented example body containing a field the DTO does not declare fails
outright when copied.

1. **`api-reference.md:283–293`, create client.** The example body includes
   `"status": "ACTIVE"`, which `CreateClientDto` does not declare. Posting that example
   verbatim returns `400`. The field should be removed from the example, or accepted by the
   DTO.
2. **`api-reference.md:276` and `apps/web/CLAUDE.md:84`, list clients.** Both document
   `GET /clients (?status=ACTIVE)`. `ClientsController.findAll` takes no query parameters
   and `ClientPrismaRepository.findAll` applies no status filter — the parameter is simply
   ignored. Either implement the filter or drop it from both documents; the frontend
   filters client-side meanwhile, as it does for projects (B8).
3. **Contract lifecycle.** `ContractStatus` includes `TERMINATED`, and `POST
   /contracts/:id/terminate` is documented, but the lifecycle chain shown in
   `roadmap.md:61` and `apps/web/CLAUDE.md:130` ends at `CLOSED` and never mentions the
   terminated state. Worth showing it as a terminal state alongside `CANCELLED`.

---

## Sprint 4 — accounting (A-series)

Raised 2026-08-09 against `e738bfe`, from a sweep of `apps/api/src/business/accounting`
against `api-reference.md` §6.13–6.23 run **before** any accounting screen was written. Every
finding below was produced by opening the controller, DTO or seed named in it.

A1–A3 are filed as GitHub issues, as is A14. A4–A10 are documentation and contract defects
recorded here; A11–A13 and A15 are contract and correctness gaps found while building against
the module rather than while sweeping it.

**One section of `api-reference.md` in this range is trustworthy.** §6.22 (Suppliers) and §6.23
(Posting Profiles), added by `7cf2507`, match `supplier.controller.ts` and
`posting-profile.controller.ts` field for field — verified 2026-08-11. §6.21 (Supplier Payments)
matches its DTOs too, with two caveats: its GL account codes are 4-digit (A8), and the
`allocations[]` array `CreateSupplierPaymentDto` accepts is undocumented. Everything else in
§6.13–6.23 still fails A4, A5, A7, A8 or A10.

### <a id="a1"></a>A1 — Two controllers are mounted at `/receipts`

**[#24](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/24) · Blocking · verified at `e738bfe` (2026-08-09)**

`finance.controller.ts:33` and `customer-receipt.controller.ts:18` both declare
`@Controller('receipts')`. `app.module.ts` registers `FinanceModule` (line 38) before
`AccountingModule` (line 39), and Nest resolves the first matching route, so Sprint 3 wins
`GET /receipts`, `GET /receipts/:id` and `POST /receipts/:id/allocations`. Sprint 4's
`CustomerReceipt` list, detail and allocate are unreachable.

It does not 404 — it returns a `PaymentReceipt` with a `200`. The 87 accounting integration
tests do not catch it because they exercise services, not the HTTP router.

**Frontend impact:** Sprint 4 Tier B2 (Client Invoices) and B3 (Customer Receipts) are cut
from sprint scope. The remaining 15 accounting screens are unaffected.

### <a id="a2"></a>A2 — The accounting module has no authorization

**[#25](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/25) · Security · verified at `e738bfe` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`frontend-design.md` §11.2 lists six permissions and states that "the backend enforces them
independently". It does not. None of the six strings appears anywhere in the repository, and
no `PermissionGuard` or `@Permissions()` decorator exists in `apps/api/src` at all — every
accounting controller carries `@UseGuards(JwtAuthGuard)` and nothing more. The `permissions`
table is never seeded, so every JWT carries `permissions: []`.

Any authenticated user in the tenant can therefore close a period, reopen a closed period,
rebuild balance snapshots, or run the year-end close.

Separately, §11.2's names (`manage:ar`, `manage:ap`, `manage:year-end`) do not follow the live
`action:resource` convention (`view:project`, `manage:role`). Worth settling before seeding.

**Frontend impact:** `can()` calls are wired into every accounting page and destructive action
using `action:resource` names, with `PERMISSIONS_ENFORCED` left `false` in
`apps/web/src/features/auth/permissions/can.ts` so nothing is hidden while the array is empty.
One boolean secures all 15 screens once a guard exists.

### <a id="a3"></a>A3 — `Supplier` and `PostingProfile` have no endpoints

**[#26](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/26) · Blocking · verified at `e738bfe` (2026-08-09)**

`CreateSupplierBillDto` requires `supplierId`; `CreateSupplierBillLineDto` requires
`expenseProfileCode`. Both models exist (`schema.prisma:1172`, `:1220`) and neither has a
controller. No supplier is seeded either, so there is no way to obtain a valid `supplierId`
through the API at all — `POST /bills` and `POST /payments` cannot be exercised. Four posting
profiles *are* seeded but nothing exposes them.

`POST /purchase-orders` also takes a `supplierId`, so Sprint 5 hits the same wall.

**Asked for:** `GET /suppliers` and `GET /posting-profiles`, read-only, to populate pickers.

### <a id="a4"></a>A4 — §6.20's create-bill body is wrong in three places

**Contract · verified against `create-supplier-bill.dto.ts` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

| Documented | Actual | Effect |
|---|---|---|
| `amount` | `netAmount` | required field missing → `400` |
| *(absent)* | `vatAmount` | required field missing → `400` |
| `postingProfileCode` | `expenseProfileCode` | required field missing → `400` |

The documented example's `"postingProfileCode": "GENERAL-EXPENSE"` is also not one of the four
seeded codes (`PROJECT_REVENUE`, `MATERIAL_PURCHASE`, `SUBCONTRACT_COST`, `OFFICE_EXPENSE`).
A bill built faithfully from the reference fails on every line.

### <a id="a5"></a>A5 — §6.13 omits required fields on both account bodies

**Contract · verified against `create-account.dto.ts` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`controlPostingPolicy` is required (`@IsEnum`, no `@IsOptional`) and is absent from the
documented create-account body. The bulk-import example is worse: it omits `isPostingAllowed`,
`isControlAccount`, `controlPostingPolicy` **and** `effectiveFrom`, all required, and
`ImportCoaDto` validates each element with `@ValidateNested`. Every documented row `400`s.

The DTO also accepts an optional `parentAccountCode`, which the reference does not mention —
relevant because §11.4's Chart of Accounts screen is a hierarchy browser.

### <a id="a6"></a>A6 — `CreateAccountDto` rejects a policy the seed itself uses

**Contract · verified against `schema.prisma:2245` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`ControlPostingPolicy` has three values. `CreateAccountDto` declares
`@IsEnum(['UNRESTRICTED','SYSTEM_ONLY'])` and so rejects `SYSTEM_OR_APPROVED_ADJUSTMENT` —
which is the policy `accounting-phase1.seed.ts` gives both seeded bank accounts. An account of
a kind the system already contains cannot be created through the API.

### <a id="a7"></a>A7 — `GET /bills?status=` is documented but not implemented

**Docs · verified against `supplier-bill.controller.ts:21` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

Only `supplierId` is read. Status filtering has to be done client-side. Same for `/payments`.

### <a id="a8"></a>A8 — Every GL account code in the reference is fictional

**Docs · verified against `accounting-phase1.seed.ts` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

§6.13–6.23 uses four-digit codes throughout — `1010`, `2000`, `1300`, `3100`. The seeded chart
is five-digit: Accounts Payable is `20000`, Supplier Advance `20100`, Accounts Receivable
`11000`, Retained Earnings `31000`, banks `10100`/`10200`.

Every documented post body (`{"apAccountCode": "2000"}` and friends) therefore fails account
lookup. This is the single most repeated defect in the section and the easiest to fix.

### <a id="a9"></a>A9 — Money is a JSON number across the AP write path

**Contract · verified against the AP DTOs (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`netAmount`, `vatAmount`, `unitPrice`, `totalAmount` and both allocation `amount` fields are
`@IsNumber()`. Every other money field on this API is a decimal string, and C8 was raised for
exactly this on the read side.

**No live precision bug:** `supplier-bill.service.ts:70` converts to `Decimal` on arrival and
sums with `.plus()`, so nothing is added in floating point. The objection is to the contract —
the rule is either the rule or it is not, and the frontend now has to special-case AP.

### <a id="a10"></a>A10 — There is no `GET /periods`

**Docs · verified against `period.controller.ts` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

The controller exposes only `:id/lock`, `:id/close`, `:id/reopen`, `:id/close-gate`,
`:id/snapshot/rebuild` and `fiscal-year/:fiscalYearId/close`. There is no list and no detail.

Not a blocker: `fiscal-year.repository.ts:19,26` includes `periods` ordered by `periodNumber`
on both `GET /fiscal-years` and `GET /fiscal-years/:id`, so §11.7's Period List is buildable
from the fiscal year. Worth saying so in the reference, because the spec reads as though a
period collection exists.

---

## Sprint 5 — procurement (P-series)

Raised 2026-08-09 from the contract sweep of `api-reference.md` §6.24–6.32 against the nine
controllers in `apps/api/src/business/procurement/`, run before any procurement UI was
written. `apps/web/CLAUDE.md` mandates this sweep; the Sprint 4 equivalent found ten defects,
three blocking, and this one found seventeen.

The character of the two sweeps differs. The A-series was mostly documentation drift — the
reference describing a body the DTO did not accept. Seven of the P-series are defects in the
implementation itself, and three of those corrupt the commitment ledger, which is the
financial record Sprint 5 exists to produce. **P11 and P12 mean the Commitments figures shown
to a project manager will be wrong in ordinary use, not in an edge case.**

Every entry below was produced by opening the named file. Nothing here is inferred from docs.

### <a id="p1"></a>P1 — `GET /procurement/materials` has no `search` parameter

**Gap · verified against `material.controller.ts:22-31` and `material.repository.ts:38` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

§12.10 specifies `<MaterialPicker>` as "search by code or name (debounced, calls
`GET /procurement/materials?search=...`)". The controller reads only `materialCategoryId` and
`spendCategoryId`; the repository has no `search` branch and no `contains` filter. The
parameter is silently ignored — no `400`, just an unfiltered list.

**Frontend impact:** the picker fetches the full active catalogue once and filters in memory.
Correct for a catalogue of hundreds; it will not survive tens of thousands. Debouncing is
pointless and has been left out.

### <a id="p2"></a>P2 — Deactivating a UoM or material makes it permanently invisible

**Gap · verified against `uom.service.ts:24` and `material.service.ts:32` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`UomService.findAll` calls the repository with a hard-coded `'ACTIVE'`. `MaterialService.findAll`
hard-codes `{ status: 'ACTIVE', ...filters }`. Both repositories accept a `status` argument, and
neither controller exposes one — so the filter exists at every layer except the one reachable
over HTTP.

Two consequences. §12.4's "Filter: status (ACTIVE / INACTIVE)" cannot be built. And because
`POST /:id/deactivate` and `POST /:id/discontinue` are the only writes, deactivation is a
one-way trapdoor from the UI's point of view: the row vanishes from the only list that exists
and nothing can bring it back or even show that it is there.

**Frontend impact:** no status filter is rendered on either screen. The confirm dialog says the
record will disappear from the list permanently, because that is what happens.

### <a id="p3"></a>P3 — UoM deactivation has no in-use guard

**Gap · verified against `uom.service.ts:40-45` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

§12.4 says deactivate is available "only if no materials use this UoM". `deactivate` looks the
UoM up and calls `setStatus` — there is no reference check. A UoM in use by live materials can
be deactivated, after which `MaterialService.create` rejects new materials against it
(`material.service.ts:52`) while existing ones keep pointing at an inactive unit.

The frontend cannot substitute its own pre-check either: the materials list returns only
`ACTIVE` rows (P2), so a count of dependants is not obtainable.

### <a id="p4"></a>P4 — A material request can never reach `CLOSED`

**Contract · verified against `material-request.controller.ts` and `material-request.service.ts:40-45` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`NEXT_STATUS` permits `APPROVED → CLOSED` and `PARTIALLY_ORDERED → CLOSED`, and §6.28's status
machine documents `CLOSED` as terminal. No controller route calls `transition(..., 'CLOSED')` —
only `submit`, `approve` and `cancel` exist. `CLOSED` is reachable in the state machine and
unreachable over HTTP.

The same applies to `SUBMITTED → DRAFT`, which `NEXT_STATUS` allows as a return-to-requester
path and which no endpoint exposes.

**Frontend impact:** §12.5's action table offers Close on `APPROVED` and `PARTIALLY_ORDERED`.
Neither button is rendered. A `PARTIALLY_ORDERED` request has no available action at all.

**Asked for:** `POST /procurement/material-requests/:id/close`, and a decision on whether
return-to-draft is intended.

### <a id="p5"></a>P5 — No authorization anywhere in the procurement module

**Security · verified against all nine procurement controllers (2026-08-09)**

Every controller carries `@UseGuards(JwtAuthGuard)` and nothing else. There is no
`PermissionGuard` class anywhere in `apps/api/src`, the `permissions` table is never seeded,
and every JWT therefore carries `permissions: []`.

Any authenticated user in the organization can approve a purchase order — which writes
`CommitmentLedgerEntry` rows — post a goods receipt, and approve a bill-matching exception.
The nine permission keys in §12.2 (`approve:purchase-order`, `approve:matching-exception`,
`manage:procurement-config` …) exist in the design document and nowhere in the codebase.

This is A2 repeated in a second module. A2 concerned closing a fiscal year; this concerns
committing the organization's money to a supplier.

**Frontend impact:** `can()` is called on every procurement action with the §12.2 keys, and
`PERMISSIONS_ENFORCED` remains `false` — enforcing it would hide every control from every
user including the administrator. One boolean in `can.ts` turns on both workspaces once the
backend seeds permissions and applies a guard.

### <a id="p6"></a>P6 — A rejected delivery line cannot be recorded

**Blocking — bug · verified against `create-goods-receipt.dto.ts:14-22` (2026-08-09)**

```ts
@IsPositive() receivedQuantity: number;
@IsPositive() acceptedQuantity: number;
```

`@IsPositive()` rejects `0`. Two things follow.

**A fully rejected line is impossible.** `qualityStatus: 'REJECTED'` is one of four documented
values (§6.30) and can never be sent, because a wholly rejected line has
`acceptedQuantity: 0`. The service itself handles zero correctly — `goods-receipt.service.ts:214`
skips accrual with `if (acceptedQty.lessThanOrEqualTo(0)) continue` — so the rule is enforced
only by the validator, and only by accident.

**The documented create pattern `400`s.** §12.7 says to pre-populate one GRN line per ACTIVE
revision PO line. A partial delivery leaves the untouched lines at `0`, and the whole request
is rejected.

**Frontend impact:** the GRN create screen omits zero-quantity lines from the payload rather
than sending them, and blocks `accepted = 0` client-side with an explanation. `REJECTED` is
absent from the quality-status select, because choosing it produces a body the API refuses.

### <a id="p7"></a>P7 — `uomCode` is required on every line and ignored on MATERIAL lines

**Contract · verified against `material-request.service.ts:96-106` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`CreateMrLineDto.uomCode` and `CreatePoLineDto.uomCode` are `@IsString()` with no
`@IsOptional()`. For `lineType: MATERIAL` the service resolves the material and uses
`material.baseUnitOfMeasureId`, never reading `uomCode`. §6.28 documents the behaviour but not
that the field is still mandatory.

**Frontend impact:** the line editor sends the material's own base UoM code — the honest value,
and discarded either way.

### <a id="p8"></a>P8 — MR create validates none of its foreign keys, including `projectId`

**Security · verified against `material-request.service.ts:75-130` (2026-08-09)**

`create` checks the scope rules and resolves `materialCode` and `uomCode` against the caller's
organization. `projectId`, `boqNodeId`, `spendCategoryId`, `departmentId`, `costCenterId` and
`projectCostCategoryId` are passed to `repo.create` unexamined. Any string is accepted.

A `projectId` belonging to a different organization is stored without complaint, attributing a
material request — and through PO allocation, eventually commitment ledger entries — to another
tenant's project. This is the same class as B11 and C16, both of which were fixed.

**Frontend impact:** none directly; the pickers only offer in-org records. Raised because the
server is the boundary and this one is open.

### <a id="p9"></a>P9 — The over-receipt tolerance is not discoverable, and 5% is only the fallback

**Contract · verified against `goods-receipt.service.ts:15,90-96` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — **open, and this finding needs correcting.** `PLATFORM_FALLBACK_OVER_RECEIPT_PERCENT` (`goods-receipt.service.ts:18`) is `new Decimal('5')`, and no `OverReceiptPolicy` row is seeded anywhere in `prisma/seeds/` — so §12.7's 5% is in fact correct in every environment today. The defect is narrower than recorded: the tolerance resolves through a PO → category → org hierarchy (`goods-receipt.repository.ts:131–147`) that no endpoint exposes, so the figure on screen becomes silently wrong the day a policy row is inserted, and nothing in the UI can tell that it has.*

The tolerance is resolved per organization and spend category from an `OverReceiptPolicy`
record, falling back to `PLATFORM_FALLBACK_OVER_RECEIPT_PERCENT = 5` only when none is seeded.
No endpoint exposes `OverReceiptPolicy`.

§12.7 instructs the UI to warn "exceeds the ordered quantity by more than 5%". That sentence is
wrong for any organization that has seeded a policy, and the frontend has no way to know which
case it is in.

**Frontend impact:** the warning is worded without asserting a number — it says the delivery
exceeds the ordered quantity and that the receipt may be held as `EXCEPTION_PENDING` for review.
The client-side threshold used to decide whether to show it at all is the 5% fallback, which is
the best available guess.

### <a id="p10"></a>P10 — An `EXCEPTION_PENDING` goods receipt is stuck forever

**Correctness — bug · verified against `goods-receipt.service.ts:186,251` and `purchase-order.service.ts` (2026-08-09)**

`post` begins `if (grn.status !== 'DRAFT') throw new ConflictException(...)`, so an
`EXCEPTION_PENDING` receipt cannot be posted. Nothing anywhere transitions it back to `DRAFT`:
`approve` and `revise` on the purchase order never read or write goods-receipt status, and no
resolve endpoint exists.

§12.7 tells the user to "resolve via PO revision first". Approving a revised PO does not
re-evaluate the receipt. The only exit is `cancel`, and the goods are already on site.

**Frontend impact:** the exception banner does not promise that revising the PO will clear it,
because it will not. The only offered action is Cancel, with an explanation.

**Asked for:** either a resolve endpoint, or re-evaluation of open `EXCEPTION_PENDING` receipts
when a PO revision covering them is approved.

### <a id="p11"></a>P11 — Superseding a revision reverses the whole commitment, not the balance

**Correctness — bug · verified against `purchase-order.service.ts` `approve()` (2026-08-09)**

When a new revision is approved and a previous `ACTIVE` revision exists, the service writes a
compensating `COMMITTED` entry per old line for the **full** original value:

```ts
const amount = unitPrice.mul(qty).negated();   // qty = full orderedQuantity
```

But posting a goods receipt against that revision has already written
`COMMITTED −(acceptedQty × unitPrice)` (`goods-receipt.service.ts:216`). The received portion is
therefore reversed twice, and `COMMITTED` for the purchase order goes negative by the accepted
amount.

Worked example, matching the seeded figures in §12.9: order 25 t at 850 → `COMMITTED +21,250`.
Receive and accept 23 t → `COMMITTED −19,550`, `ACCRUED +19,550`; committed balance `1,700`,
correct. Now revise the PO and approve → `COMMITTED −21,250` for the superseded revision, plus
the new revision's own positive entry. The old revision's net contribution is `−19,550`, not the
`+1,700` that was actually outstanding.

§12.6 instructs the approve drawer to state that "its uncommitted balance will be reversed."
That is what should happen and is not what does.

**Frontend impact:** the approve drawer states plainly that approving supersedes the current
revision and writes new commitment entries. It makes no claim about the uncommitted balance,
because the claim would be false.

### <a id="p12"></a>P12 — Cancelling a purchase order leaves its commitments standing

**Correctness — bug · verified against `purchase-order.service.ts` `cancel()` (2026-08-09)**

`cancel` walks the revisions, sets each non-terminal one to `CANCELLED`, sets the PO to
`CANCELLED`, and returns. No commitment ledger entry is written.

Every `COMMITTED` row from the approval survives the cancellation, so a cancelled purchase order
continues to consume commitment forever. The `sourceDocumentType` enum contains
`PO_CANCELLATION`, and the only code that uses it is the supersede path in `approve` — which
suggests the reversal was designed and never wired.

**Frontend impact:** the Commitments card (§12.9) and the commitment ledger will overstate
committed cost by the value of every cancelled PO. The cancel confirmation says so, and the
ledger screen carries a note. Neither is a fix — the figures are wrong at the source.

### <a id="p13"></a>P13 — `revise` requires a `supplierId` it discards

**Contract · verified against `create-purchase-order.dto.ts:113` and `purchase-order.service.ts` `RevisePoDto` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`RevisePurchaseOrderDto extends CreatePurchaseOrderDto`, inheriting a required `supplierId`.
The service's own `RevisePoDto` interface has no such field and `revise` never reads one — a
supplier cannot be changed by revision, which is correct, but the body must carry the value
anyway. §6.29's revise example does include it, without saying it is ignored.

**Frontend impact:** the revise drawer resends the PO's existing `supplierId`.

### <a id="p14"></a>P14 — The PO list cannot show a total, and its revision number is misleading

**Contract · verified against `purchase-order.repository.ts:66-75` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — **open for the total; half of it is already fixed.** `findAll` (`purchase-order.repository.ts:73`) now includes `supplier: true`, so the supplier name IS resolvable on the PO list. P16's fix reached purchase orders as well as bills, which was never recorded. The revision embed is still `take: 1` with no `lines`, so §12.6's Total Amount remains uncomputable from the list response and Revision still shows the highest-numbered revision rather than the active one.*

```ts
include: { supplier: true, revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } }
```

Two problems for §12.6's list spec. The embedded revision has **no `lines`**, so
`extendedAmount` is absent and "Total Amount = sum of extendedAmount on the ACTIVE revision's
lines" cannot be computed without one detail fetch per row. And `take: 1` by descending
revision number returns the **highest-numbered** revision, which is the `DRAFT` one whenever a
revision is in progress — not the `ACTIVE` revision the column is supposed to describe.

`supplier: true` *is* included, so supplier name is available on both list and detail. This is
the one place a supplier name can be resolved at all — see P16.

**Frontend impact:** the Total Amount column is omitted from the PO list. The revision column is
labelled "Latest revision" and shows that revision's status, which is what the payload actually
contains.

### <a id="p15"></a>P15 — The server posts unmatched bills; the matching gate is UI-only

**Security — bug · verified against `supplier-bill.service.ts:149-154` (2026-08-09)**

```ts
const POSTABLE_MATCH_STATUSES = ['MATCHED', 'MATCHED_WITH_TOLERANCE', 'APPROVED_EXCEPTION', 'NOT_RUN'];
```

`NOT_RUN` is in the allow-list. §6.31 states the rule in the opposite direction — "the bill's
`matchStatus` must be `MATCHED`, `MATCHED_WITH_TOLERANCE`, or `APPROVED_EXCEPTION` before
posting is allowed" — and adds the explicit UI rule that Post must be disabled on `NOT_RUN` or
`EXCEPTION`. A bill linked to a PO revision that has never been matched posts straight to the
general ledger.

`EXCEPTION` *is* blocked, so the exception-approval path works. It is the never-matched path
that is open — the more likely one, since `NOT_RUN` is the default (`schema.prisma:1502`).

Three-way matching is the control that stops an organization paying for goods it did not
receive. Implemented on the client only, it stops nothing: any caller with a token can `POST
/bills/:id/post` directly.

**Frontend impact:** the UI implements the gate as specified — Post is disabled on `NOT_RUN` and
`EXCEPTION` with an explanation. This is deliberately stricter than the server. It is a usability
affordance, not a control, and must not be recorded as one.

### <a id="p16"></a>P16 — Supplier name is unresolvable on every AP screen

**Gap · verified against `supplier-bill.repository.ts:39-51` (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — fix holds. `supplier-bill.repository.ts:47` selects `{ id, code, name }`. Note it does **not** select `nameAr`, while the purchase-order repository includes the whole supplier relation and therefore does — so the same supplier renders in English on a bill and in Arabic on a PO. See A13.*

`findById` includes `lines` only; `findAll` includes nothing. Neither embeds the `supplier`
relation, so both return a bare `supplierId`. With no `GET /suppliers` (A3 / #26) there is no
second call that could resolve it.

**Frontend impact:** the Supplier Bills list and detail show the bill's own identifiers and
amounts. Where §12.8 expects a supplier name, the screens show a muted "Supplier unavailable"
with a footnote naming #26 — rather than a raw cuid, which is worse than nothing.

The purchase order screens are unaffected: `purchase-order.repository.ts` includes
`supplier: true` (P14).

### <a id="p17"></a>P17 — Money and quantity are JSON numbers across the procurement write path

**Contract · verified against all five procurement write DTOs (2026-08-09)**

> *Re-verified at `4a895e7` (2026-08-11) — still open.*

`unitPrice`, `orderedQuantity`, `requestedQuantity`, `receivedQuantity`, `acceptedQuantity`,
`rejectedQuantity`, `allocatedQuantity` and `exchangeRate` are all `number`. Every read path
returns Prisma `Decimal`, serialized as a decimal string — `"21250.00"`, `"25"` — so the same
field is a string coming out and a number going in.

This is A9 extended from AP to the whole of procurement. As with A9 there is no live precision
bug on the server: every value is wrapped in `new Decimal(...)` on arrival. The objection is the
same one — `constraints.md`'s money-as-string rule is either the rule or it is not, and
`apps/web/src/lib/money.ts` is built entirely around integer minor units.

**Frontend impact:** procurement keeps money and quantities in minor units throughout — parsing,
validation, `extendedAmount`, and the `accepted + rejected = received` check — and converts at
the API boundary only, in a single `toApiNumber()` in `src/features/procurement/api/`. That
function is the one thing to delete when this is fixed.

### <a id="c18"></a>C18 — The guarantee lifecycle has three names and is missing one state

> *Raised 2026-08-14 while building the Commercial Overview guarantees table. A domain
> question for **Eng Ahmed Shirie**, not a bug to patch.*

Three sources disagree about the states a bank guarantee can be in:

| Source | States |
|---|---|
| `GuaranteeStatus` (`schema.prisma:2334`) | `ACTIVE` · `DISCHARGED` · `EXPIRED` · `CALLED` |
| ADR-017 §"Guarantee attention" | `ACTIVE` · `DISCHARGED` · `CALLED` · `EXPIRED` · `CANCELLED`* |
| The Commercial specification | Active · **Released** · Expired · Called |

Two separate problems.

**"Discharged" vs "Released."** The same event under two names. A quantity surveyor reading
"Discharged" and a contract administrator reading "Released" cannot be sure they are looking
at the same fact, and the UI currently shows whichever word the translation file happened to
get. One name, chosen by the domain, then used in the enum, the ADR, the spec and both
locales.

**There is no `CANCELLED`.** ADR-017 lists it with an asterisk; the enum does not have it.
A guarantee issued against a contract that is later cancelled before execution has nowhere
to go — it is not discharged (nothing was performed), not expired (the date has not passed),
and not called. Today it stays `ACTIVE` forever on a dead contract, which is exactly the row
that will trigger a false "expiring soon" prompt later.

**Frontend position meanwhile:** the guarantees table renders the enum verbatim through
`guaranteeStatusTone`, and keeps **lifecycle** and **attention** in two separate columns —
`EXPIRING_SOON` is a prompt, not a legal status, and merging them would make an ACTIVE
guarantee look expired. Nothing is invented and no state is renamed in the UI. When the
naming is settled the change is one enum, one migration, and two translation values.

---

---

## What the frontend is building meanwhile

Delivered:

- Auth hardening: silent refresh, session bootstrap, correct logout, host-derived tenant
- App shell: navigation, i18n/RTL, responsive layout
- Dashboard: status counts and recent projects, aggregated client-side (see B8, B10)

- BOQ: initialize, version selection, tree with currency-safe totals, baseline, discard
  draft, start revision, and add/edit/delete of sections and items
- Projects: list, search and filter, create, edit (DRAFT), detail, all six lifecycle
  transitions, cancel, suspend and resume

- Sprint 3 billing chain: Clients, Contracts and their commercial terms, IPA with its full
  lifecycle, IPC viewing, issuance and supersession, Receipts with allocation
- Sprint 4 accounting workspace: ten screens, plus Tier G (Client Invoices)
- Sprint 5 procurement workspace: fifteen routes, plus read-only Supplier Bills and Matching

Building next — Accounts Payable, in four tiers:

1. **Suppliers** — list and create (no edit; **A15**), a shared `SupplierPicker`, and flipping
   `SUPPLIER_ENDPOINT_AVAILABLE`, which enables the purchase-order create form that has been
   written, tested and switched off since Sprint 5 Tier C
2. **Supplier bill create — non-PO bills only**, gated by **A14**
3. **Supplier payments** — list, detail, create, approve, post, reverse
4. **Advance allocation** against a bill, and its reversal

Deferred, and why:

- **Customer Receipts** — **A12**. A receipt carries two unlinked allocation ledgers and the
  domain question of whether that is one settlement or two is with Eng Ahmed. Building the
  allocation screen before it is answered is how double-counted cash reaches a client statement.
- **PO-linked supplier bills** — **A14** / [#33](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/33)
- **Tenant bootstrap** — chart-of-accounts creation, bulk import, fiscal years, bank accounts
  and the opening-balance wizard. Not blocked by anything; `POST /accounts`,
  `POST /accounts/import`, `POST /fiscal-years`, `POST /bank-accounts` and
  `POST /accounting/opening-balance` are all live and unconsumed. Chart of Accounts and Fiscal
  Periods are read-only screens today, so a new organisation cannot be set up from the UI at all.
  Note **A5** and **A6** before building it: the documented create-account body omits a required
  field, and `CreateAccountDto` rejects the `ControlPostingPolicy` value three seeded accounts use.
- **Per-document approval panel** on Material Requests and Purchase Orders — buildable now,
  since `approvalInstanceId` is a scalar on both payloads, but **B15** should land first.
- **Approval inbox** — not buildable at all. No endpoint lists approval instances, by approver
  or otherwise, so there is no way to discover an `instanceId` you were not already handed.
- **Report drill-down** — `GET /reports/drill-down` and `GET /reports/gl-balance/:accountId`
  are live and unconsumed.
- **BOQ parent totals for mixed-currency subtrees** — **D1**, with Eng Ahmed.

Corrected on 2026-08-11: **Project members UI** was listed here as deferred on **B1** and
**B2**. Both were fixed in `e85bab9`, and `GET/POST /projects/:id/members`,
`DELETE /projects/:id/members/:userId` and `GET /users` have all been live since. The page at
`projects/[id]/members/page.tsx` is still a dashed "unavailable" placeholder. Nothing blocks it.

The security items — **A2** and **P5** (no authorization anywhere in the API) and **B15** — are
independent of everything above. `RolesGuard` is registered as `APP_GUARD` in `app.module.ts:46`
and reads a `'roles'` metadata key that no controller anywhere sets, so it returns `true` on
every request. Nothing the frontend builds changes that, and `PERMISSIONS_ENFORCED = false` in
`can.ts` is the honest mirror of it rather than a workaround.
