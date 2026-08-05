/** `GET /audit-logs` — one entry per recorded state change. */
export interface AuditLogEntry {
  id: string;
  userId: string;
  orgId: string;
  action: string;
  resource: string;
  resourceId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  /** Included by the API when the controller selects the user relation. */
  user?: { firstName: string; lastName: string; email: string };
}
