import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { InputJsonValue } from '@prisma/client/runtime/library';
import type { NotificationKind } from '@erp/types';

import { deriveNotificationSeverity } from '../domain/notification-severity.policy.js';

export interface NotificationWriteRow {
  organizationId: string;
  recipientUserId: string;
  kind: NotificationKind;
  /** One row per (recipient, dedupeKey) — the ADR-031 idempotency key. */
  dedupeKey: string;
  projectId?: string | null;
  contractId?: string | null;
  resourceType: string;
  resourceId: string;
  /** Interpolation values only — never prose, never amounts. */
  contextData: Record<string, string | number>;
  actionUrl: string | null;
}

/**
 * ADR-044 §10 — event-driven notifications, written INSIDE the caller's transaction so a
 * notification exists exactly when the business change it announces committed (a rolled-back
 * command leaves none). ADR-031 conventions: unique (org, recipient, dedupeKey), `actionUrl`,
 * `contextData` = interpolation values, severity derived from the kind.
 *
 * Not gated by NOTIFICATIONS_GENERATION_ENABLED, which keeps governing the daily cron generator
 * only. Reusable by any module that needs immediacy.
 */
@Injectable()
export class NotificationWriter {
  /**
   * Upsert by (org, recipient, dedupeKey). An existing row is refreshed and re-armed (resolvedAt
   * cleared) but its `readAt` is never touched: a reader is not re-alerted for the same key.
   */
  async upsertMany(tx: Prisma.TransactionClient, rows: NotificationWriteRow[]): Promise<void> {
    for (const row of rows) {
      const severity = deriveNotificationSeverity(row.kind);
      const contextData = row.contextData as InputJsonValue;
      await tx.notification.upsert({
        where: {
          organizationId_recipientUserId_dedupeKey: {
            organizationId: row.organizationId,
            recipientUserId: row.recipientUserId,
            dedupeKey: row.dedupeKey,
          },
        },
        create: {
          organizationId: row.organizationId,
          recipientUserId: row.recipientUserId,
          kind: row.kind,
          severity,
          dedupeKey: row.dedupeKey,
          projectId: row.projectId ?? null,
          contractId: row.contractId ?? null,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          contextData,
          actionUrl: row.actionUrl,
        },
        update: { kind: row.kind, severity, contextData, actionUrl: row.actionUrl, resolvedAt: null },
      });
    }
  }

  /** Resolve every open row of `kinds` about one resource (they leave the feed and the badge). */
  async resolve(
    tx: Prisma.TransactionClient,
    where: { organizationId: string; resourceType: string; resourceId: string; kinds: NotificationKind[] },
  ): Promise<number> {
    const { count } = await tx.notification.updateMany({
      where: {
        organizationId: where.organizationId,
        resourceType: where.resourceType,
        resourceId: where.resourceId,
        kind: { in: where.kinds },
        resolvedAt: null,
      },
      data: { resolvedAt: new Date() },
    });
    return count;
  }
}
