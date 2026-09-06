-- Repair: manual journals that were posted twice.
--
-- `ManualJournalService.post()` called the posting engine, which creates the canonical
-- POSTED journal with its own copy of every line, and then ALSO flipped the authoring
-- record to POSTED without removing its lines. Both rows matched `status = 'POSTED'`,
-- and every report aggregates journal_lines filtered on exactly that — so the trial
-- balance, both P&Ls, the balance sheet and project actual cost each counted every
-- manual journal twice. Debits and credits doubled together, so nothing that checks
-- balance could detect it.
--
-- The authoring row is kept: it carries who drafted, submitted and approved. It is
-- linked to the entry that replaced it and stripped of its lines, which is what the
-- service now does at post time.
--
-- Idempotent, and a no-op on an installation that never posted a manual journal.

-- 1. Link each authoring row to the canonical GL entry the engine created for it.
--    The engine posts with source_document_id = <authoring row id> and
--    accounting_event_id = 'MANUAL-' || <authoring row id>, which is what pairs them.
UPDATE journal_entries staging
SET    replaced_by_journal_entry_id = canonical.id
FROM   journal_entries canonical
WHERE  staging.source_document_type = 'MANUAL_JOURNAL'
  AND  staging.status = 'POSTED'
  AND  staging.replaced_by_journal_entry_id IS NULL
  AND  staging.source_document_id LIKE 'draft-%'
  AND  canonical.organization_id     = staging.organization_id
  AND  canonical.source_document_type = 'MANUAL_JOURNAL'
  AND  canonical.source_document_id   = staging.id
  AND  canonical.accounting_event_id  = 'MANUAL-' || staging.id
  AND  canonical.id <> staging.id;

-- 2. Drop the duplicated lines. Only from rows that are provably superseded — a row
--    with no canonical counterpart is left completely alone.
DELETE FROM journal_lines
WHERE  journal_entry_id IN (
  SELECT staging.id
  FROM   journal_entries staging
  WHERE  staging.source_document_type = 'MANUAL_JOURNAL'
    AND  staging.status = 'POSTED'
    AND  staging.replaced_by_journal_entry_id IS NOT NULL
);

-- 3. Restore reversed manual journals to POSTED.
--    Reversal used to move the original out of POSTED *and* post the mirror entry.
--    Since reports read `status = 'POSTED'`, that removed the original's lines and
--    added the mirror's, leaving the accounts at minus the original amount. The
--    original must stay POSTED and be offset by its reversal; the reversal link and
--    reversed_by/reversal_reason already record that it happened.
UPDATE journal_entries original
SET    status = 'POSTED'
WHERE  original.status = 'REVERSED'
  AND  original.source_document_type = 'MANUAL_JOURNAL'
  AND  EXISTS (
    SELECT 1 FROM journal_entries reversal
    WHERE reversal.reversal_of_journal_entry_id = original.id
      AND reversal.status = 'POSTED'
  );
