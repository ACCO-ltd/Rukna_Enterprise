-- Exactly one BASELINED cost budget per project, enforced by the database.
--
-- The invariant lived only in application code: baseline() supersedes the previous BASELINED
-- row and promotes the draft in one transaction. That is correct, but it is the kind of rule
-- a financial control should not depend on a single code path to hold — a second writer, a
-- data fix or a future endpoint would silently break it, and "which budget is this project
-- measured against?" would then have two answers with nothing to say which.
--
-- A partial unique index is the right shape: it constrains only BASELINED rows, so any number
-- of DRAFT and SUPERSEDED versions coexist as the history requires.
--
-- Prisma's schema language cannot express a partial index, so this is written by hand and
-- carries this comment rather than living in schema.prisma. `prisma migrate diff` stays clean
-- because an extra index is not a model difference.

-- Guard: if any project already has two baselined versions, keep the newest and supersede the
-- rest rather than failing the migration. Ordering by version number is the same rule the
-- application uses to decide which is current.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY project_id ORDER BY version_number DESC) AS rn
  FROM   project_cost_budgets
  WHERE  status = 'BASELINED'
)
UPDATE project_cost_budgets b
SET    status = 'SUPERSEDED',
       superseded_at = COALESCE(b.superseded_at, now())
FROM   ranked
WHERE  ranked.id = b.id
  AND  ranked.rn > 1;

CREATE UNIQUE INDEX "project_cost_budgets_one_baselined_per_project"
  ON "project_cost_budgets" ("project_id")
  WHERE "status" = 'BASELINED';
