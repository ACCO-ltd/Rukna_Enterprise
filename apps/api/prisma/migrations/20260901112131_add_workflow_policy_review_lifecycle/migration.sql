-- AlterEnum
ALTER TYPE "WorkflowPolicyStatus" ADD VALUE 'IN_REVIEW';

-- AlterTable
ALTER TABLE "workflow_policy_versions" ADD COLUMN     "review_notes" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_user_id" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "submitted_by_user_id" TEXT;
