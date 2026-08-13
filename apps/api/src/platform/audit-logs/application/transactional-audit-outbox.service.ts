import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InputJsonValue } from '@prisma/client/runtime/library';

export interface TransactionalAuditCommand {
  organizationId: string;
  actorUserId: string;
  actorRoleContext?: Record<string, unknown>;
  action: string;
  resourceType: string;
  resourceId: string;
  sourceCommand: string;
  eventType: string;
  idempotencyKey: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  approvalInstanceId?: string;
  correlationId?: string;
  requestId?: string;
  ipAddress?: string;
}

/**
 * Use only inside the transaction that changes the aggregate. The immutable audit
 * record and the durable outbox event either commit together with that mutation,
 * or roll back together.
 */
@Injectable()
export class TransactionalAuditOutboxService {
  async record(tx: Prisma.TransactionClient, command: TransactionalAuditCommand): Promise<void> {
    const audit = await tx.auditLog.create({
      data: {
        userId: command.actorUserId,
        orgId: command.organizationId,
        action: command.action,
        resource: command.resourceType,
        resourceId: command.resourceId,
        before: command.before as InputJsonValue | undefined,
        after: command.after as InputJsonValue | undefined,
        actorRoleContext: command.actorRoleContext as InputJsonValue | undefined,
        reason: command.reason,
        sourceCommand: command.sourceCommand,
        approvalInstanceId: command.approvalInstanceId,
        correlationId: command.correlationId,
        requestId: command.requestId,
        ipAddress: command.ipAddress,
      },
    });

    await tx.auditOutboxEvent.create({
      data: {
        organizationId: command.organizationId,
        auditLogId: audit.id,
        aggregateType: command.resourceType,
        aggregateId: command.resourceId,
        eventType: command.eventType,
        idempotencyKey: command.idempotencyKey,
        payload: {
          auditLogId: audit.id,
          organizationId: command.organizationId,
          actorUserId: command.actorUserId,
          action: command.action,
          resourceType: command.resourceType,
          resourceId: command.resourceId,
          sourceCommand: command.sourceCommand,
          correlationId: command.correlationId ?? null,
          requestId: command.requestId ?? null,
          approvalInstanceId: command.approvalInstanceId ?? null,
        } as InputJsonValue,
      },
    });
  }
}
