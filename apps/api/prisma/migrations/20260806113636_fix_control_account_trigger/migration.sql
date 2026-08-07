-- Fix the control account guard trigger:
-- The original function incorrectly queried journal_entries.posting_origin,
-- which does not exist. The posting_origin is on journal_lines (NEW row).

CREATE OR REPLACE FUNCTION trg_control_account_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_policy TEXT;
BEGIN
  IF NEW.account_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT control_posting_policy INTO v_policy
  FROM account_versions WHERE id = NEW.account_version_id;

  IF v_policy = 'SYSTEM_ONLY' AND NEW.posting_origin = 'MANUAL' THEN
    RAISE EXCEPTION 'CONTROL_ACCOUNT_DIRECT_POSTING_PROHIBITED: account version % is SYSTEM_ONLY',
      NEW.account_version_id;
  END IF;

  RETURN NEW;
END;
$$;
