import { Injectable, Inject } from '@nestjs/common';

import type {
  IAuditLogsRepository,
  CreateAuditLogData,
} from '../domain/interfaces/audit-logs-repository.interface.js';
import type { AuditLogEntity } from '../domain/entities/audit-log.entity.js';

@Injectable()
export class AuditLogsService {
  constructor(
    @Inject('IAuditLogsRepository')
    private readonly auditLogsRepository: IAuditLogsRepository,
  ) {}

  async log(data: CreateAuditLogData): Promise<void> {
    await this.auditLogsRepository.create(data);
  }

  async findByOrg(orgId: string, limit = 50): Promise<AuditLogEntity[]> {
    return this.auditLogsRepository.findByOrg(orgId, limit);
  }
}
