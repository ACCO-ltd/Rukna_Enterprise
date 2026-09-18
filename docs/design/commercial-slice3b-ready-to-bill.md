# Slice 3B — Ready-to-Bill: Product Report

**Date:** 2026-09-17  
**Slice:** 3B (Persist & Enforce Commercial Readiness)  
**Status:** IMPLEMENTED, TESTS GREEN, NOT DEPLOYED

---

## 1. What was built

A new readiness gate that decouples _"this milestone is physically done"_ from _"we are commercially ready to raise an invoice."_ Before Slice 3B, the billing command would attempt to invoice any milestone on an ACTIVE contract once the programme milestone was verified. After Slice 3B, a finance manager must explicitly mark the installment ready to bill before `billStage` will proceed.

---

## 2. User-facing change

The **Contract & Milestones** tab now sends a real API call when the user clicks "Mark ready to bill" in the Review for Billing drawer. The green "Ready to bill" badge persists across page reloads. Undoing readiness (revoke) is available until the invoice is raised.

Previously, clicking the button changed a local React state set that was lost on refresh.

---

## 3. Schema change

Three nullable columns added to `contract_payment_installments`:

| Column | Type | Purpose |
|--------|------|---------|
| `ready_to_bill_at` | `TIMESTAMPTZ?` | Timestamp the installment was approved; null = not ready |
| `ready_to_bill_by` | `TEXT?` | User ID of the approver |
| `readiness_note` | `TEXT?` | Optional approval note (max 500 chars) |

`readyToBill` is derived as `readyToBillAt != null`. No stored boolean.

Migration: `20260917140000_add_installment_readiness` (applied).

---

## 4. New commands

### `markReadyToBill(identity, installmentId, note?)`

Guards (in priority order):

1. Installment must exist in this org — 404 if not.
2. Caller must be a contract member (`projectAccess.assertContract`).
3. Contract must be `ACTIVE` — 400 if DRAFT/SUSPENDED/etc.
4. No invoice may already exist for this installment — 400 if already billed.
5. If the installment is linked to a programme milestone, that milestone must be `VERIFIED` — 400 if `PLANNED`.
6. **Idempotent**: if `readyToBillAt` is already set, returns the existing timestamp without writing a duplicate audit event.

Writes inside a single transaction: `UPDATE contract_payment_installments` + one `MILESTONE_READY_TO_BILL` audit event.

### `revokeReadyToBill(identity, installmentId, reason?)`

Guards:
1. Installment must exist — 404.
2. Contract membership — same as above.
3. Must be currently marked ready (`readyToBillAt != null`) — 400 if not.
4. No invoice may exist — 400 if already billed (readiness becomes historical record at that point).

Writes: clears all three columns to `null` + one `MILESTONE_READINESS_REVOKED` audit event.

---

## 5. Billing gate

`billStage` now has a new first-check immediately after loading the installment:

```
if (!installment.readyToBillAt) → 400 "not marked ready to bill"
```

This fires before any variation resolution, before any invoice creation attempt. Existing ACTIVE contracts with no readiness set will be blocked from billing until the mark-ready step is performed. No backfill is needed for already-invoiced installments (those have an invoice so the gate would not be reached in normal flow).

---

## 6. New REST endpoints

```
POST   /projects/:projectId/commercial/installments/:installmentId/mark-ready-to-bill
DELETE /projects/:projectId/commercial/installments/:installmentId/mark-ready-to-bill
```

Both return `InstallmentReadinessResult`:
```typescript
{ installmentId: string; readyToBill: boolean; readyToBillAt: string | null }
```

Permission: `contractsView` (class-level) + `contractsManage` (method-level). Lower bar than `receivablesManage` (required for `billStage`). The domain boundary is permission-based, not role-named: whoever holds `contractsManage` performs commercial readiness review; whoever holds `receivablesManage` issues the invoice. Current ACCO practice maps these to different people, but that is an organizational policy, not a domain constraint.

---

## 7. Read model changes (`getCurrentCycle`)

Four new fields per `CommercialPaymentScheduleInstallment`:

| Field | Derivation |
|-------|-----------|
| `readyToBill` | `readyToBillAt != null` |
| `readyToBillAt` | ISO 8601 string or `null` |
| `canMarkReadyToBill` | `status === NEXT && (no milestone OR VERIFIED) && !invoice` |
| `canPrepareInvoice` | `readyToBill && status === NEXT && (no milestone OR VERIFIED)` |

The UI reads these flags rather than re-deriving them.

---

## 8. Frontend changes

**`commercial-api.ts`** — two new functions: `markInstallmentReadyToBill` and `revokeInstallmentReadiness`.

**`use-mark-ready-to-bill.ts`** — new hooks: `useMarkReadyToBill` and `useRevokeReadyToBill`. Both invalidate the `current-cycle` query on success, causing the milestone journey to refresh from real data.

**`milestone-journey.adapter.ts`** — three changes:
- `readyToBill: inst.readyToBill ?? false` (was hardcoded `false`)
- `resolveUserState` now emits `'ready-to-bill'` when `inst.readyToBill === true` AND status is `NEXT`
- Comments updated to remove SLICE_3A_MOCK references

**`contract-milestones-tab.tsx`** — two changes:
- `readyToBillIds` state removed; replaced with `useMarkReadyToBill(projectId)` mutation
- `ScheduleBody` no longer receives or applies `readyToBillIds` overlay; the adapter derives state from API data directly

---

## 9. Tests

**`commercial-readiness.db.spec.ts`** — 19 new live-DB scenarios covering:
- Guard rejection: inactive contract (R-01), unverified milestone (R-02)
- Success: unlinked installment (R-03), idempotency (R-04)
- DB invariants: no invoice created, no contract value change, no allocation rows (R-05..R-07)
- Milestone upgrade path: PLANNED → VERIFIED → mark ready succeeds (R-08)
- `billStage` gate: rejects un-ready installment (R-09), succeeds on ready one (R-10)
- Post-billing guard: mark-ready rejects on invoiced installment (R-11)
- Revoke lifecycle: success (R-12), double-revoke rejected (R-13), revoke-after-invoice rejected (R-14)
- Financial invariant: percentage × base = 200,000 unchanged (R-15), no allocations (R-16)
- Read-model field verification: `readyToBillAt` null/non-null assertions (R-17..R-19)

**`commercial-bill-stage.integration.spec.ts`** — updated to pre-mark all installments ready in `seed()`. All 9 existing billing tests pass.

**Frontend (`milestone-journey.test.tsx` etc.)** — all 184 tests pass; adapter's VERIFIED-milestone-without-readiness case still produces `'review-for-billing'` (not `'ready-to-bill'`), confirming the two states are distinct.

**Full counts:** 19 new + 77 backend commercial passing + 184 frontend passing.

---

## 10. What was NOT changed

Per the DO-NOT-MODIFY constraints:
- Prisma schema for `ClientInvoice`, `VariationBillingAllocation`, `VariationOrder` — unchanged.
- Invoice posting logic and accounting journals — unchanged.
- Receipt allocations — unchanged.
- BOQ percentage mathematics — unchanged.
- `billStage` invoice orchestration — only the readiness pre-check was added; the rest of the method is untouched.

---

## 11. Open items for Slice 4

- **Invoice preparation UI**: "Prepare Invoice" CTA driven by `canPrepareInvoice === true` — the backend is ready, the frontend dialog (`PrepareInvoiceDialog`) exists as Slice 4A mock; wire it to `billStage`.
- **`paymentTermsDays`**: placeholder comment in `ContractHeader` notes where this field goes.
- **Credit note flow**: omissions against already-invoiced stages require a credit note path (not yet built).

---

## 12. Migration path for existing data

Existing installments on the live `rukna_acco` database have `ready_to_bill_at = NULL`. These installments are blocked from billing until explicitly marked ready. The correct deployment procedure:

**Already-invoiced installments** — leave `ready_to_bill_at = NULL`. They are historical records. `billStage` will never be called on them again, so the gate is never reached.

**Unbilled installments** — deploy, then the commercial reviewer opens each one in the UI (Review for Billing drawer) and clicks "Mark ready to bill" when commercially satisfied. This is precisely what the feature was introduced to accomplish.

If ACCO needs specific installments unblocked immediately on go-live, produce a reviewed list of specific IDs and run a targeted script. Do **not** use a broad SQL rule that silently approves all active unbilled installments — that creates a false commercial record (`readyToBillAt` set, `readyToBillBy = 'system-migration'`) for stages that may have unverified programme milestones or that have not been commercially reviewed, defeating the purpose of the readiness gate.
