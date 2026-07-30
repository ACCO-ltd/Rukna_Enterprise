import { Injectable } from '@nestjs/common';
import type { InputJsonValue } from '@prisma/client/runtime/library';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import type {
  IAuditLogsRepository,
  CreateAuditLogData,
} from '../domain/interfaces/audit-logs-repository.interface.js';
import { AuditLogEntity } from '../domain/entities/audit-log.entity.js';

@Injectable()
export class AuditLogsPrismaRepository implements IAuditLogsRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async create(data: CreateAuditLogData): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        orgId: data.orgId,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        before: (data.before ?? undefined) as InputJsonValue | undefined,
        after: (data.after ?? undefined) as InputJsonValue | undefined,
        ipAddress: data.ipAddress,
      },
    });
  }

  async findByOrg(orgId: string, limit = 50): Promise<AuditLogEntity[]> {
    const prisma = this.tenancyService.getClient();
    const logs = await prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return logs.map((l) => this.toDomain(l));
  }

  private toDomain(raw: {
    id: string;
    userId: string;
    orgId: string;
    action: string;
    resource: string;
    resourceId: string;
    before: unknown;
    after: unknown;
    ipAddress: string | null;
    createdAt: Date;
  }): AuditLogEntity {
    return new AuditLogEntity(
      raw.id,
      raw.userId,
      raw.orgId,
      raw.action,
      raw.resource,
      raw.resourceId,
      raw.before as Record<string, unknown> | null,
      raw.after as Record<string, unknown> | null,
      raw.ipAddress,
      raw.createdAt,
    );
  }
}
