import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { InputJsonValue } from '@prisma/client/runtime/library';
import type { AuditLogPage, AuditLogQuery } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import type {
  IAuditLogsRepository,
  CreateAuditLogData,
} from '../domain/interfaces/audit-logs-repository.interface.js';

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
        reason: data.reason,
      },
    });
  }

  async findPage(
    orgId: string,
    query: Required<Pick<AuditLogQuery, 'page' | 'pageSize'>> & AuditLogQuery,
  ): Promise<AuditLogPage> {
    const prisma = this.tenancyService.getClient();
    const search = query.search?.trim();
    const where: Prisma.AuditLogWhereInput = {
      orgId,
      ...(query.resource ? { resource: query.resource } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              // Inclusive: everything before the start of the next day.
              ...(query.to ? { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search, mode: 'insensitive' } },
              { resource: { contains: search, mode: 'insensitive' } },
              { resourceId: { contains: search } },
              { reason: { contains: search, mode: 'insensitive' } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
              { user: { firstName: { contains: search, mode: 'insensitive' } } },
              { user: { lastName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, rows, resources, actors] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      prisma.auditLog.findMany({ where: { orgId }, distinct: ['resource'], select: { resource: true }, orderBy: { resource: 'asc' } }),
      prisma.auditLog.findMany({
        where: { orgId },
        distinct: ['userId'],
        select: { user: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        resource: row.resource,
        resourceId: row.resourceId,
        reason: row.reason,
        ipAddress: row.ipAddress,
        user: row.user
          ? { id: row.user.id, name: `${row.user.firstName} ${row.user.lastName}`.trim(), email: row.user.email }
          : null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      facets: {
        resources: resources.map((r) => r.resource),
        users: actors
          .map((a) => ({ id: a.user.id, name: `${a.user.firstName} ${a.user.lastName}`.trim() }))
          .sort((x, y) => x.name.localeCompare(y.name)),
      },
    };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
