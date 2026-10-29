import type { AuditLogPage, AuditLogQuery } from '@erp/types';

export interface IAuditLogsRepository {
  create(data: CreateAuditLogData): Promise<void>;
  /** One page of the organisation's trail, newest first, with the filter facets. */
  findPage(orgId: string, query: Required<Pick<AuditLogQuery, 'page' | 'pageSize'>> & AuditLogQuery): Promise<AuditLogPage>;
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
