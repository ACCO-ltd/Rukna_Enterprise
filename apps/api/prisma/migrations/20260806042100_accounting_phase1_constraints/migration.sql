-- Accounting Phase 1: raw SQL constraints and triggers
-- (Not expressible in Prisma schema DSL)

-- ── Extension ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Version range non-overlap (half-open [effectiveFrom, effectiveTo)) ────────
-- Prevents two versions of the same entity from covering the same date.

ALTER TABLE account_versions
  ADD CONSTRAINT ux_account_versions_no_overlap
  EXCLUDE USING gist (
    account_id         WITH =,
    daterange(effective_from::date, effective_to::date, '[)') WITH &&
  );

ALTER TABLE department_versions
  ADD CONSTRAINT ux_department_versions_no_overlap
  EXCLUDE USING gist (
    department_id      WITH =,
    daterange(effective_from::date, effective_to::date, '[)') WITH &&
  );

ALTER TABLE cost_center_versions
  ADD CONSTRAINT ux_cost_center_versions_no_overlap
  EXCLUDE USING gist (
    cost_center_id     WITH =,
    daterange(effective_from::date, effective_to::date, '[)') WITH &&
  );

ALTER TABLE posting_profile_versions
  ADD CONSTRAINT ux_posting_profile_versions_no_overlap
  EXCLUDE USING gist (
    posting_profile_id WITH =,
    daterange(effective_from::date, effective_to::date, '[)') WITH &&
  );

-- ── CostCenter.departmentId immutability ──────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_cost_center_dept_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    RAISE EXCEPTION 'COST_CENTER_DEPARTMENT_IMMUTABLE: cannot reassign cost center to a different department';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cost_center_department
  BEFORE UPDATE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION trg_cost_center_dept_immutable();

-- ── Journal balance check (fires on transition to POSTED) ─────────────────────

CREATE OR REPLACE FUNCTION trg_journal_balance_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_debit  NUMERIC;
  v_credit NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(debit_amount),  0),
    COALESCE(SUM(credit_amount), 0)
  INTO v_debit, v_credit
  FROM journal_lines
  WHERE journal_entry_id = NEW.id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'IMBALANCED_JOURNAL: debit=% credit=% entry=%',
      v_debit, v_credit, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_entry_on_post
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'POSTED' AND NEW.status = 'POSTED')
  EXECUTE FUNCTION trg_journal_balance_check();

-- ── Control account posting guard ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_control_account_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_policy TEXT;
  v_origin TEXT;
BEGIN
  IF NEW.account_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT control_posting_policy INTO v_policy
  FROM account_versions WHERE id = NEW.account_version_id;

  IF v_policy = 'SYSTEM_ONLY' THEN
    SELECT posting_origin INTO v_origin
    FROM journal_entries WHERE id = NEW.journal_entry_id;

    IF v_origin = 'MANUAL' THEN
      RAISE EXCEPTION 'CONTROL_ACCOUNT_DIRECT_POSTING_PROHIBITED: account version % is SYSTEM_ONLY',
        NEW.account_version_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_line_control_account
  BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION trg_control_account_guard();

-- ── Posted-journal attachment immutability ────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_journal_attachment_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM journal_entries WHERE id = OLD.journal_entry_id;
  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION 'ATTACHMENT_IMMUTABLE: cannot delete attachment from a POSTED journal entry';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_journal_entry_attachments_immutable
  BEFORE DELETE ON journal_entry_attachments
  FOR EACH ROW EXECUTE FUNCTION trg_journal_attachment_immutable();
