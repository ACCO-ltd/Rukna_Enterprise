import { Injectable } from '@nestjs/common';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { loadActorNames } from '../../users/application/actor-names.js';
import { activityCode, type ActivityEntryView } from '../domain/record-activity.js';

/** Enough history for a document page; a record with more belongs in the audit log screen. */
const LIMIT = 200;

/**
 * The audit trail of specific records, newest first (ADR-036).
 *
 * Unlike `GET /audit-logs` — organisation-wide, 50 rows, gated by `view:audit-log` — this is a
 * read service for document pages. The caller owns authorisation: it must already have
 * confirmed the viewer may read the record, and it passes only that record's ids.
 */
@Injectable()
export class RecordActivityService {
  constructor(private readonly tenancyService: TenancyService) {}

  async forRecords(orgId: string, resourceIds: string[]): Promise<ActivityEntryView[]> {
    if (resourceIds.length === 0) return [];
    const prisma = this.tenancyService.getClient();
    const rows = await prisma.auditLog.findMany({
      where: { orgId, resourceId: { in: resourceIds } },
      orderBy: { createdAt: 'desc' },
      take: LIMIT,
      select: { id: true, userId: true, action: true, resource: true, createdAt: true, reason: true },
    });
    const actorName = await loadActorNames(prisma, rows.map((r) => r.userId));
    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      actor: { id: row.userId, name: actorName(row.userId) },
      code: activityCode(row.action, row.resource),
      ...(row.reason ? { reason: row.reason } : {}),
    }));
  }
}
