import { Injectable, Inject } from '@nestjs/common';

import type {
  IAuditLogsRepository,
  CreateAuditLogData,
} from '../domain/interfaces/audit-logs-repository.interface.js';
import type { AuditLogPage, AuditLogQuery } from '@erp/types';

@Injectable()
export class AuditLogsService {
  constructor(
    @Inject('IAuditLogsRepository')
    private readonly auditLogsRepository: IAuditLogsRepository,
  ) {}

  async log(data: CreateAuditLogData): Promise<void> {
    await this.auditLogsRepository.create(data);
  }

  /** One page of the organisation's trail, newest first (Step 8: searchable, filterable, named). */
  async findPage(orgId: string, query: AuditLogQuery): Promise<AuditLogPage> {
    return this.auditLogsRepository.findPage(orgId, {
      ...query,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    });
  }
}

const DEFAULT_PAGE_SIZE = 50;
