ALTER TYPE "WorkflowPolicyStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW';

ALTER TABLE "workflow_policy_versions"
  ADD COLUMN IF NOT EXISTS "submitted_by_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_notes" TEXT;
