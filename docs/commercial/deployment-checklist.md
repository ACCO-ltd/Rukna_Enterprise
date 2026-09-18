# Commercial Release Checklist — Slice 8

## Pre-deploy

- [ ] Full database backup (`pg_dump`)
- [ ] Run `pnpm tsx scripts/commercial-data-audit.ts --slug=acco` — review output; fix any `⛔` integrity issues before proceeding
- [ ] Confirm migration count: `prisma migrate status` shows **87 applied** (86 existing + idempotency key migration)
- [ ] Confirm no pending migrations on staging
- [ ] Confirm API TypeScript: `cd apps/api && npx tsc --noEmit` — zero errors
- [ ] Confirm web TypeScript: `cd apps/web && npx tsc --noEmit` — zero errors

## Deploy

- [ ] `prisma migrate deploy` on target DB
- [ ] Verify schema.prisma version matches deployed migration chain
- [ ] Deploy API build
- [ ] Deploy web build

## Post-deploy Smoke

- [ ] Login as ACCO commercial user (role: `commercial_manager` or `finance_manager`)
- [ ] Open a project → **Commercial** → **Overview** loads (financial strip visible, no error banner)
- [ ] Click **Contract & Milestones** tab → contract header + milestone journey + payment schedule visible
- [ ] Click **Billing & Collection** tab → invoice list loads
- [ ] Navigate to old URL `/projects/:id/commercial/contract-security` → redirects cleanly to `contract-milestones` (no 404, no loop)
- [ ] Navigate to old URL `/projects/:id/commercial/payment-schedule` → redirects cleanly to `contract-milestones`
- [ ] Navigate to old URL `/projects/:id/commercial/variations` → redirects cleanly to `contract-milestones`
- [ ] **Issue a test invoice** on staging: mark ready → issue package → verify INV number generated
- [ ] **Record a payment** on staging → verify receipt created, outstanding balance reduced
- [ ] **Double-submit test**: submit the same payment twice with the same `idempotencyKey` → verify only one receipt created (check DB: `SELECT count(*) FROM payment_receipts WHERE idempotency_key = '...'`)
- [ ] Login as a user WITHOUT `financialPositionView` → verify all money amounts show "—" (not actual figures)
- [ ] Check browser console for JS errors on all three tabs

## Rollback

1. **Application rollback**: redeploy previous API + web builds — no DB change needed (migration #87 added only an additive nullable column; both old and new code are compatible).
2. **Database rollback** (only if migration caused data loss or corruption): restore from pre-deploy backup.
3. **Do NOT** attempt to reverse posted journal entries or cancel issued invoices as a deployment rollback step — these are financial records, not deployment artefacts.
4. If the `payment_receipts.idempotency_key` column causes issues, it can be dropped with a manual `ALTER TABLE payment_receipts DROP COLUMN idempotency_key` — the column is nullable and has no FK references.

## Notes

- The `NOTIFICATIONS_GENERATION_ENABLED` flag remains OFF post-deploy (dormant since ADR-031).
- Browser QA owed for all slices since Slice 4B (billing package) — run the full golden-path journey in the Slice 8 smoke tests above.
- The `commercial-data-audit.ts` script is read-only — safe to re-run at any time against production.
