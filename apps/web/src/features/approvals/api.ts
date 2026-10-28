import { apiClient } from '@/lib/api-client';
import type { ApprovalInbox } from '@erp/types';

/** Step 3 (ADR-049) — `GET /approvals/inbox`: everything waiting on the caller's decision. */
export function getApprovalsInbox(): Promise<ApprovalInbox> {
  return apiClient<ApprovalInbox>('/approvals/inbox');
}
