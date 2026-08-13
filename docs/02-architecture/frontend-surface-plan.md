# Frontend Surface Plan — Governance, Project P&L, Config

**Purpose:** surface the Sprint 6 backend (governance seam + loop-back, RBAC, Project Actual P&L)
that has **no UI yet**. Written 2026-08-13, after the backend landed on `main` (ADRs 011–015).

Each item lists: **what**, **why now**, **endpoints**, **files**, **acceptance**, **dependency**.
Sequenced by value-per-effort and dependency. Money/permission rules already exist in the app
(`money.ts`, `can()`); reuse them.

---

## F-A. Approval flow: the `409` gate + loop-back (biggest gap)

**What.** Make governed commands drivable from the UI. Today the approval panel only does
approve/reject for MR and PO. It must handle the full gate cycle for **PurchaseOrder, SupplierBill,
SupplierPayment**:

1. Command returns **`409 { approvalInstanceId }`** → show "Pending approval", render the approval
   panel for that instance (don't treat `409` as a hard error).
2. Approvers act via `POST /workflows/instance/:id/approve` (role-enforced now — a `403` means the
   caller lacks the step's `roleRequired`).
3. When `GET /workflows/instance/:id/step` shows the instance `APPROVED`, **re-invoke the original
   command** (the ADR-015 re-drive) → it now proceeds and the entity transitions.

**Why now.** The backend governance is functional but invisible/undriveable beyond MR/PO. Without
the re-drive, a gated PO/bill/payment can never complete from the app.

**Endpoints.** `POST /purchase-orders/:id/submit`, `POST /bills/:id/submit`,
`POST /payments/:id/approve` (all may `409`); `GET /workflows/instance/:id/step`;
`POST /workflows/instance/:id/{approve,reject}`. See api-reference §6.5.

**Files.** Generalize `features/workflows/components/approval-panel.tsx` +
`features/workflows/approval-actions.ts`; add the panel to `features/accounting/.../bill-screens.tsx`
and `payment-screens.tsx`; a shared `useGatedCommand` hook that catches `409`, stores
`approvalInstanceId`, and exposes a `redrive()` that re-calls the command. Mirror `mr-detail.tsx` /
`po-detail.tsx` which already read `approvalInstanceId`.

**Acceptance.** Submit a governed PO → panel appears, no error toast; approve down the chain; the
PO reaches SUBMITTED after re-drive. Same for bill submit and payment approve. `403` on a
wrong-role approve shows "You do not have the required role for this step". Bilingual + 375px.

**Dependency.** None on backend (done). Needs at least one seeded binding to see gating live — see
F-C. Until then, panels render only when a `409` occurs.

---

## F-B. Project Actual P&L screen

**What.** A "Financials → Actual P&L (GL)" panel on the project workspace, calling
`GET /projects/:id/pl?fromDate&toDate`. Same `PLReportResult` shape as the org P&L already rendered.

**Why now.** The endpoint + index shipped this session; it's low effort (reuse the existing P&L
renderer) and high value per hour.

**Endpoint.** `GET /projects/:id/pl` (api-reference §6.24, "Project Actual P&L").

**Files.** `features/projects/components/` new `project-pl-content.tsx`; add to the project
workspace shell tabs (a "Financials" tab); reuse the accounting P&L presentational component;
`accounting-api.ts` add `getProjectPl(projectId, fromDate, toDate)`.

**Acceptance.** Open a project with posted, project-tagged journal lines → P&L renders revenue /
CoS / gross / expenses / net. Date-range picker. **Labelled "Project Actual P&L (GL)"** with a
one-line hint that it excludes committed/forecast cost (ADR-013) — do **not** present it as the
complete picture. Bilingual + 375px.

**Dependency.** None. Data appears only for projects whose bills/invoices were posted with a
`projectId` (the entry-form dimension fields must be captured — verify supplier-bill/journal forms
send `projectId`).

---

## F-C. DOA workflow configuration UI (admin)

**What.** Under `/admin/workflows`, let an authorized admin create/activate
`WorkflowTriggerBinding` + `WorkflowRequirementPolicy` rows so a transition actually requires
approval (turn governance on per transition).

**Why now.** Governance is fully built but **switched off by configuration** — no bindings are
seeded and there's no UI to add them. Without this, F-A never fires in production.

**Endpoints.** ⚠️ **Backend gap — do not stub.** There is no CRUD endpoint for bindings/policies
yet. This item is **blocked on backend**: needs `GET/POST /workflows/bindings` (+ requirement
policies), which is Abdulsalam's to add. File the issue first.

**Dependency.** **Backend first.** Also interacts with value-threshold routing (ADR-011), which
needs Eng Ahmed's CFO/CEO thresholds.

---

## F-D. Close the frontend tracker (F-series)

**What.** Verify and close the F-series (#52–65) that the recent client/project UX commits already
delivered (F-01…F-09 look done); build **F-11** (Project IPC tab — its blocker #49 is fixed);
run the QA passes **F-12/13/14** (responsive, a11y, E2E). **F-10** stays blocked on #51.

**Why now.** The tracker overstates remaining work; closing it clarifies what's actually left.

**Dependency.** F-10 → #51 (Eng Ahmed).

---

## Not in this plan (need backend/domain first)

- **Project Financial Position** (rich: budget/committed/forecast) — ADR-013's read model is
  **not built on the backend**. F-B is only the *Actual* half.
- **Customer Receipts UI** — blocked on **A12** (Eng Ahmed): one settlement ledger or two.
- **Variations / Subcontracts / File attachments** — backend + domain answers don't exist yet.

---

## Suggested sequence

1. **F-B** (project P&L) — fast, self-contained, high value.
2. **F-A** (approval gate + loop-back) — the big one; unblocks the whole governance story in the UI.
3. **F-D** (close/verify F-series, build F-11, QA).
4. **F-C** — only after the backend bindings CRUD exists (file that backend issue now).
