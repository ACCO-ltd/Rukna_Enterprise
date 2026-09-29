-- Accounting hardening (deep audit follow-up).
-- Defense-in-depth constraints, most not expressible in the Prisma schema DSL, plus the
-- PeriodAccountBalance uniqueness that the schema now declares.

-- ── 1. One snapshot row per (period, account) ─────────────────────────────────
-- SnapshotService.generateForPeriod deletes+recreates snapshots per period; a concurrent or
-- retried close/rebuild could double-insert, and every SUM-based report would then double-count.
-- The unique index makes a double-insert fail loudly instead of silently corrupting reports.
CREATE UNIQUE INDEX "period_account_balances_accounting_period_id_account_id_key"
  ON "period_account_balances"("accounting_period_id", "account_id");

-- ── 2. Accounting periods must not overlap within an organization ─────────────
-- Mirrors the account-version non-overlap guard (ux_account_versions_no_overlap). An accounting
-- date must resolve to exactly ONE period; overlapping periods would let PeriodValidator silently
-- pick one (orderBy startDate desc) and misattribute a posting. btree_gist is already enabled.
ALTER TABLE accounting_periods
  ADD CONSTRAINT ux_accounting_periods_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    daterange(start_date::date, end_date::date, '[]') WITH &&
  );

-- ── 3. Journal balance check on INSERT (defense-in-depth) ─────────────────────
-- The posting engine INSERTs journal_entries already at status = 'POSTED' with their lines nested,
-- so the existing BEFORE UPDATE trigger (trg_journal_entry_on_post) never fires for a real posting.
-- A plain AFTER INSERT row trigger would run before the nested journal_lines exist and see zero
-- lines (0 = 0, passes trivially). A DEFERRABLE INITIALLY DEFERRED constraint trigger fires at
-- COMMIT, after all lines are inserted, so debit = credit is enforced at the database for every
-- posted entry — not only by the in-process JS validator. Reuses trg_journal_balance_check().
CREATE CONSTRAINT TRIGGER trg_journal_entry_balance_on_insert
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'POSTED')
  EXECUTE FUNCTION trg_journal_balance_check();
