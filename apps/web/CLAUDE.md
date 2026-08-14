# Frontend — AI Agent Rules
# apps/web/ — Construction ERP (Rukna Platform)

---

## STOP BEFORE YOU START

Read these documents **in order** before making any change or answering any question:

1. `/docs/reference/api-reference.md` — **Every live endpoint, request/response shapes, auth flow, error format. Read this first.**
2. `/docs/01-capability-matrix.md` — What is actually built, backend vs frontend (authoritative status)
3. `/docs/reference/frontend-design.md` — **Canonical frontend design plan: navigation, components, build sequence, interaction patterns.**
4. `/docs/reference/domain-model.md` — Entity definitions, enums, business rules
5. `/docs/reference/architecture.md` — Stack, module map, Clean Architecture rules
6. `/docs/reference/tenancy.md` — Multi-tenancy (subdomain), TenantContext
7. `/AGENTS.md` — Engineering operating manual
8. `/docs/reference/constraints.md` — Engineering constraints
9. `/docs/02-domain-boundaries.md` — Aggregate ownership

---

## ⚠️ BACKEND BOUNDARY WARNING ⚠️

The following paths are **NOT** owned by the frontend engineer.
Do **NOT** modify them. Do **NOT** instruct an AI agent to modify them.

```
apps/api/**
apps/api/prisma/schema.prisma
packages/types/src/**
docker-compose.yml
apps/api/.env
```

If you need a backend change (new endpoint, different response shape, schema addition):

1. STOP — do not implement it yourself
2. Create a GitHub issue describing what you need
3. Contact **Abdulsalam** (backend engineer) for review and implementation
4. Wait for the updated types in `packages/types/` before consuming them

If you have a question about construction domain logic (how an IPC works, what triggers a
retention release, approval chain rules):

Contact **Eng Ahmed Shirie** (CEO, ACCO Ltd) — he is the domain expert.

Implementing incorrect business logic is worse than waiting for clarification.

---

## What You Own

```
apps/web/src/**           ← Your primary workspace
packages/ui/src/**        ← Shared UI components (you own this)
```

---

## What Is Live Right Now

`/docs/reference/api-reference.md` is the endpoint reference — every path, request
and response shape. Read it there rather than from a copy here.

This file used to carry its own endpoint listing. It drifted: it documented a
`?status=ACTIVE` filter on `GET /clients` that the controller does not accept, and a
frontend engineer built against it. Two sources of truth for the same contract means one
of them is wrong and nobody knows which.

For discrepancies between the reference and the running API, see
`/docs/backend-requests/frontend-blockers.md`.

**Sprint 3 patch notes** (PR #23 — merged): IPA add-item body is `{ boqNodeId, cumulativeClaimed }` only; IPC issue body has no `certifiedTotal`; RETENTION/ADVANCE_RECOVERY deductions are auto-generated; payment-status response is `{ totalAllocated: string; netCertified: string; status }`. Full details in `api-reference.md`.

> **Payment status response shape:**
> ```json
> { "totalAllocated": "6498.00", "netCertified": "6498.00", "status": "PAID" }
> ```
> Both monetary values are **decimal strings**, not numbers. `netCertified` = gross certified minus deductions.

> **Allocation guards (all return `400`):**
> - IPC belongs to a different client than the receipt → show "Cannot allocate: certificate belongs to a different client"
> - IPC currency ≠ receipt currency → show "Currency mismatch" error
> - `allocatedAmount ≤ 0` → form validation
> - Cumulative allocations exceed receipt amount → show remaining balance

---

## Build Queue — What to Build Next

Build in this order. Each sprint's backend is complete and tested before appearing here.

### ✅ Sprint 4 Frontend — Accounting Workspace (done 2026-08-09)

Ten screens under `/finance/accounting`, in `src/features/accounting/`. Chart of Accounts,
Fiscal Periods, Manual Journals (list/editor/detail with the full lifecycle), Trial Balance,
P&L, Balance Sheet, Account Ledger, Monthly Comparison, and period management.

**Four things to know before you touch accounting or start Sprint 5:**

1. **`api-reference.md` §6.13–6.23 is wrong in ten places.** Read the controllers and DTOs in
   `apps/api/src/business/accounting/` instead. The create-bill body has three wrong field
   names, the create-account body omits a required field, and every GL account code in the
   section is 4-digit while the seeded chart is 5-digit — so a body copied out of the
   reference `400`s or `404`s. All ten are A4–A10 in `frontend-blockers.md`.
2. **Money arithmetic lives in `src/lib/money.ts`,** in integer minor units with an explicit
   `scale`. Sprint 5 quantities are 3dp (`QUANTITY_SCALE`), money is 2dp. Use
   `parseMinorUnits` for user input — it returns `null` on a bad value rather than `0`,
   because a typo reading as a valid zero is how an unbalanced journal passes validation.
3. **Accounting strings live in `messages/{en,ar}/accounting.json`,** not `platform.json`.
   Give procurement its own `procurement.json` and register it in `src/i18n/request.ts` and
   `src/test/render.tsx`. `src/i18n/catalogues.test.ts` guards duplicate keys and en/ar parity.
4. **`can()` is called on every accounting and procurement action.** Permission enforcement
   is active; the API remains the security boundary and the UI hides unavailable actions.

> **Superseded 2026-08-11 — this paragraph used to say four screens were blocked, and by the
> time anyone read it, three of the four claims were wrong.** Kept, corrected, rather than
> deleted, because the pattern matters more than the paragraph:
>
> - **Client Invoices** was never blocked by #24. `ClientInvoiceController` is mounted at
>   `@Controller('invoices')`; only customer receipts were shadowed. Built as Tier G.
> - **Supplier Bills** was over-blocked. Only `POST /bills` needed a supplier; the read path
>   always worked. Shipped read-only in Sprint 5 Tier E.
> - **#26 is fixed** as of `7cf2507`. `GET/POST /suppliers` and `GET /posting-profiles` are
>   live. Supplier Payments is no longer blocked by anything.
> - **Customer Receipts** is still not built — but on **A12**, a domain question, not #24.
>
> Still true: [#25](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/25) — the accounting
> module has no authorization at all. So does the rest of the API.

### ✅ Sprint 5 Frontend — Procurement Workspace (done 2026-08-09)

Fifteen routes under `/procurement/*` plus two under `/finance/accounting/bills`, in
`src/features/procurement/`. Master data (UoM, material and spend categories, materials),
Material Requests, Purchase Orders with revision tabs, Goods Receipts, Supplier Bills with
the Matching tab, and the Commitment Ledger with its project card.

**Five things to know before you touch procurement or start Sprint 6:**

1. **The contract sweep found seventeen defects — the P-series in `frontend-blockers.md`.**
   Seven are implementation bugs rather than doc drift, and **three corrupt the commitment
   ledger** (#31): cancelling a PO writes no reversal, superseding over-reverses, and an
   `EXCEPTION_PENDING` goods receipt can never be released. The Commitments card and ledger
   both carry an accuracy note for this reason. Read the P-series before trusting any
   committed figure on screen.
2. **`quantities.ts` holds every rule that can be wrong at the cent or the unit** — the
   quantity×price scale change, the GRN `accepted + rejected = received` split, over-receipt,
   MR line rules, the bill post gate. Put new procurement arithmetic there, not in a
   component. `toApiNumber` is the only place a float is produced; delete it when P17 is
   fixed.
3. **The GRN create screen omits untouched lines from the payload.** `@IsPositive()` on
   `receivedQuantity` and `acceptedQuantity` means a zero row `400`s the whole request
   (P6). If you make it send zeros again, every partial delivery breaks and nothing in the
   markup will show it. `submittableGrnLines` is the guard.
4. **The bill Post gate is stricter than the server.** `canPostBill` blocks `NOT_RUN`;
   `POSTABLE_MATCH_STATUSES` on the server permits it (P15). Do not "fix" the frontend to
   agree — fix the server. A test names this divergence deliberately.
5. **Two lint errors exist on `main` and are not Sprint 5's** —
   `src/features/ipc/wizard/ipc-wizard.tsx:148,158`, `react-hooks/set-state-in-effect`.
   They predate this branch and were left alone rather than blind-fixed, because that code
   restores an IPC draft and getting it wrong costs money.

> **Corrected 2026-08-11.** This paragraph read *"Still blocked: creating a purchase order,
> creating a supplier bill, and Supplier Payments — all #26."* **#26 was fixed in `7cf2507`.**
> `GET /suppliers`, `GET /suppliers/:id`, `POST /suppliers` and `GET /posting-profiles` are all
> live, and `api-reference.md` §6.22–6.23 documents them accurately.
>
> `listSuppliers()` in `procurement-api.ts` still rejects every call with *"GET /suppliers does
> not exist"*, and `SUPPLIER_ENDPOINT_AVAILABLE` is still `false`. The sentence below was
> correct when written and is the fix: the PO create form is built and tested behind a disabled
> entry point, and turning it on is a supplier picker plus one flag.
>
> Creating a **PO-linked** supplier bill is still blocked, but by
> [#33](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/33) (**A14**), not #26 — the bill
> never records a `purchaseOrderRevisionId`, so matching cannot run, the post gate is skipped,
> and the commitment ledger never reaches ACTUAL. Non-PO bills are unaffected.

### ✅ Sprint 4 Tier G — Client Invoices (done 2026-08-10)

Two routes under `/finance/accounting/invoices` plus a Billing card on the IPC detail page, in
`src/features/accounting/`. List, detail with the approve → post → reverse lifecycle, and
invoice generation from an effective certificate.

**Five things to know before you touch AR:**

1. **Sprint 4 recorded Client Invoices as blocked by #24. That was wrong.**
   `ClientInvoiceController` is mounted at `@Controller('invoices')` and never collided with
   anything — only customer receipts were shadowed. Six routes sat idle for a day on a
   misattributed blocker. Check where a controller is actually mounted before believing a
   blocker note.
2. **`posting-accounts.ts` resolves GL account codes by `accountSubtype`,** because every AR/AP
   post endpoint takes raw codes in its body. It returns `NOT_CONFIGURED` / `AMBIGUOUS` rather
   than taking the first match — two accounts marked `ACCOUNTS_RECEIVABLE` is a chart the user
   must fix, not one the UI should guess past. Delete this module when a posting profile can
   resolve control accounts server-side.
3. **`planInvoicePost` returns the preview and the payload from one resolution.** The Post dialog
   shows the exact Dr/Cr the server will write. If you ever compute the preview separately, the
   dialog can show one thing and send another.
4. **`canPost` is deliberately stricter than the server (A11).** The API will re-post a REVERSED
   invoice, overwriting `invoiceNumber` and orphaning the original journal. Three tests name the
   divergence. Do not relax it to match the server — fix the server.
5. **`invoiceNumber` is null until the invoice posts.** The `INV-` sequence is drawn inside the
   posting transaction, so every draft is unnumbered. Nothing may key a row on it.

**Not built, and deliberately: Customer Receipts.** `/customer-receipts` is live and unshadowed
since A1 was fixed, but a receipt carries two unlinked allocation ledgers — to IPCs and to
invoices — with no guard between them (A12). Whether that is one settlement mirrored or two is a
domain question now with Eng Ahmed. Do not build the allocation screen until it is answered.

### ⏳ Accounts Payable — Suppliers, Bills, Payments (START HERE)

Four tiers, one commit each. Sequenced by dependency: `POST /bills` and `POST /payments` both
require a `supplierId`, and no supplier is seeded in any environment.

| Tier | Contents |
|---|---|
| **A** | Suppliers list + create under Procurement's main nav items. Shared `SupplierPicker`. Flip `SUPPLIER_ENDPOINT_AVAILABLE` in `procurement-api.ts` and replace the `listSuppliers()` stub — that turns on the PO create form written in Sprint 5 Tier C. |
| **B** | Supplier bill create, **non-PO bills only** (A14 / [#33](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/33)). Matching tab reads "not applicable", not "not run". |
| **C** | Payments: list, detail, create with allocation lines, approve, post, reverse. |
| **D** | Advance allocation against a bill, and its reversal. |

**Five things to know before you start:**

1. **Suppliers go in Procurement's main items, not Setup.** A supplier is master data added
   whenever purchasing widens, not one-time configuration, so it fails the Setup sub-group's own
   stated test — and Setup's single `manage:procurement-config` gate would stop a buyer adding
   the supplier their own PO needs.
2. **There is no `PATCH /suppliers/:id`** (A15). List and create only, no edit affordance. A
   misspelt supplier name is permanent.
3. **`api-reference.md` §6.21–6.23 is trustworthy** — the payment, supplier and posting-profile
   bodies match their DTOs field for field. This is the exception in §6.13–6.23, not the rule.
   Two caveats: every GL account code in the section is 4-digit against a 5-digit seeded chart
   (A8), and the `allocations[]` array on `CreateSupplierPaymentDto` is undocumented.
4. **`POST /payments/:id/post` needs three GL codes** — `apAccountCode`, `bankGlCode`,
   `supplierAdvanceCode`. Extend `posting-accounts.ts`, which already resolves codes by
   `accountSubtype` and returns `NOT_CONFIGURED` / `AMBIGUOUS` rather than guessing. Follow
   `planInvoicePost`: resolve once, and show the dialog the exact Dr/Cr the server will write.
5. **Bank accounts are seeded; suppliers are not.** `GET /bank-accounts` returns rows on every
   environment, so the payment form's bank picker has a source on day one. `GET /suppliers`
   returns an empty list until Tier A's create form is used.

> **Run a contract sweep against the controllers before writing a screen.** Sprint 4's
> sweep found ten defects and Sprint 5's found seventeen, each in the time it took to read
> the route decorators, and each before anything was built on them. The 2026-08-11 sweep found
> three more — and found that three *existing* entries in the register were wrong in the other
> direction, describing walls that had already been demolished. Re-verify before you defer.

### ⏳ Sprint 6 Frontend — Variations / Change Orders

Backend: not yet built. Nothing to build against yet — confirm with Abdulsalam before
planning.

---

## What Is NOT Built Yet — Do Not Mock or Stub

The API does not have these endpoints. Do not build UI for them yet.

- Subcontracts / Subcontract Certificates
- Stock Ledger / Stock Transfers / Warehouse management (Sprint 7)
- Cost Ledger / Cost Reporting (Sprint 7)
- Daily Progress Reports / Measurement Sheets (Sprint 9)
- Labour Attendance / Equipment Logs (Sprint 9)
- File uploads / Attachment storage (DB tables exist, no file serving endpoint yet)
- Notifications / Expiry alerts
- Settings pages (org config, DOA thresholds, workflow builder)
- Budget Authorization (for INTERNAL_CAPITAL projects)
- Variations / Change Orders (Sprint 6 — backend not yet built)

---

## Critical Business Rules the UI Must Enforce

| Rule | What to do in UI |
|---|---|
| IPA items map to **leaf** BOQ nodes only | Only show leaf nodes in the item picker — filter by `isLeaf: true` |
| `cumulativeClaimed` = total-to-date, not this period | Show the calculation: `period = cumulative − previousEffectiveCertified` |
| `cumulativeClaimed` ≤ BOQ node `quantity` | Show remaining quantity; disable submit if exceeded |
| Unit rate and currency come from the BOQ node — never send them | Do not render `unitRateSnapshot` / `currencySnapshot` inputs in the add-item form |
| `varianceReason` required when certified ≠ claimed | Client-side validate before submitting IPC |
| `certifiedTotal` is server-computed — do not send it | Remove `certifiedTotal` from the issue-IPC form entirely |
| RETENTION and ADVANCE_RECOVERY are auto-generated — do not send them | Hide these deduction types from the IPC deduction picker |
| IPA must be `SUBMITTED` to issue a certificate | Disable "Issue Certificate" unless IPA `status === 'SUBMITTED'` |
| One effective IPC per application | If `isEffective` cert exists, hide "Issue" and show "Supersede" instead |
| Allocation: client must match | Only show IPCs in the picker that belong to the same client as the receipt |
| Allocation: currency must match | Filter or warn when IPC currency differs from receipt currency |
| Contract `execute` freezes client details forever | Warn: "Client name and tax number will be permanently locked onto this contract" |
| `practical-completion` moves ACTIVE contracts → `FINAL_ACCOUNT_PENDING` | Confirmation dialog listing affected contracts |
| Receipt allocations cannot exceed receipt amount | Show remaining unallocated balance live in form |
| IPA is immutable after `SUBMITTED` | Hide all edit controls when `status === 'SUBMITTED'` |
| `422` response = workflow not configured | Show "Approval workflow not configured — contact your system administrator" |

---

## Auth Implementation Rules

1. **Never store tokens in `localStorage`** — XSS risk. Keep `accessToken` in memory only (Zustand or React context).
2. **Never touch the `refreshToken` cookie** — it is `HttpOnly`. The browser manages it automatically.
3. **Always set `credentials: 'include'`** on every request.
4. **Refresh flow**: on `401`, call `POST /auth/refresh` once. If that also returns `401`, clear the token and redirect to `/login`.
5. Access tokens expire in **15 minutes**. Refresh is handled automatically.

This is already implemented in `src/lib/api-client.ts` — use `apiClient`, do not write a
second one. It refreshes behind a single-flight guard, because the API rotates the refresh
token and treats a reused one as an attack: two concurrent refreshes would revoke the whole
token family and sign the user out everywhere.

---

## Shared Types

Import from the monorepo package — **do not redefine locally**:

```typescript
import type { RequestIdentity } from '@erp/types';
import {
  ProjectStatus, ProjectRole, CommercialModel, ParticipationModel,
  BoqVersionStatus, MeasurementMethod, PricingBasis,
  ClientStatus,
  ContractStatus, BillingModel, AdvanceType, GuaranteeStatus,
  IpaStatus, IpcStatus,
} from '@erp/types';
```

---

## Multi-Tenancy (Subdomain)

Every API request must go to `https://{slug}.rukna.app/api/v1`.

In Next.js, read the tenant slug from `headers().get('host')` in middleware and inject
it into all API client calls. During local development:
- Backend: `http://acco.localhost:3001/api/v1`
- Frontend: `http://acco.localhost:3000`

---

## Next.js Rules

- App Router only — no Pages Router
- Server Components by default
- `'use client'` only when state or browser APIs are needed
- No direct database access — all data through the API

---

## i18n Rules (MANDATORY)

The platform is bilingual: English + Arabic (RTL).

- Every user-visible string must use `next-intl` — no hardcoded English strings in JSX
- Arabic is right-to-left — components must not assume left-to-right layout
- Test every new screen in both `en` and `ar` modes before marking complete
- The HTML `dir` attribute must reflect the active language

---

## Mobile-Responsive Rules (MANDATORY)

Every screen must work on a 375px wide viewport.

- Design mobile-first — desktop layout is an enhancement
- Test all forms and tables on a narrow viewport before marking complete
- Touch targets must be at least 44×44px

---

## API Integration Rules

- All API calls go through `src/lib/api-client.ts` — no ad-hoc fetch in components
- Use TanStack Query for all server state — no `useEffect + useState` for data fetching
- Never cache sensitive financial data in localStorage or sessionStorage
- Auth tokens are managed by the auth module — do not handle them in feature components

---

## Styling Rules

- Tailwind CSS only — no inline styles, no CSS modules unless documented
- Use `packages/ui/` components before creating new ones
- Design tokens (colors, spacing) defined in the design system — do not hardcode hex values

---

## Error Handling

All API errors return:
```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }
```

| Status | Handle as |
|---|---|
| `400` | Show `error.message` as form or toast error |
| `401` | Trigger refresh flow → redirect to login |
| `403` | Show "Access denied" |
| `404` | Show not-found state |
| `409` | Show conflict message (e.g., "Contract number already exists") |
| `422` | Show "Approval workflow not configured — contact your system administrator" |

---

## If You Are Unsure About a Business Rule

Ask before guessing. Construction ERP errors (wrong retention calculation, wrong IPC amount,
wrong approval chain) cost real money for real people.

- Technical / API question → Abdulsalam (backend engineer)
- Business / domain question → Eng Ahmed Shirie (CEO, ACCO Ltd)
