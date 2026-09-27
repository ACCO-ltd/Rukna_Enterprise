import type { AuditLogEntity } from '../entities/audit-log.entity.js';

export interface IAuditLogsRepository {
  create(data: CreateAuditLogData): Promise<void>;
  findByOrg(orgId: string, limit?: number): Promise<AuditLogEntity[]>;
}

export interface CreateAuditLogData {
  userId: string;
  orgId: string;
  action: string;
  resource: string;
  resourceId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  /** The reason a command carried in its body (`{ reason }`) — a return, a rejection, a reversal. */
  reason?: string;
}
