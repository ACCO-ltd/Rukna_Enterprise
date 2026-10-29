/**
 * `GET /audit-logs` (Step 8): the organisation's audit trail, newest first, searched and filtered
 * on the server and returned a page at a time. Each entry names the person who acted — never a
 * bare user id.
 */
export interface AuditLogView {
  id: string;
  createdAt: string;
  action: string;
  resource: string;
  resourceId: string;
  /** The reason the command carried (a return, a rejection, a reversal), if any. */
  reason: string | null;
  ipAddress: string | null;
  user: { id: string; name: string; email: string } | null;
}

export interface AuditLogPage {
  items: AuditLogView[];
  total: number;
  page: number;
  pageSize: number;
  /** The filter choices that exist in this organisation's trail. */
  facets: {
    resources: string[];
    users: Array<{ id: string; name: string }>;
  };
}

export interface AuditLogQuery {
  /** Matches the action, resource, record id, reason, or the person's name or email. */
  search?: string;
  resource?: string;
  userId?: string;
  /** Inclusive dates, YYYY-MM-DD. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
