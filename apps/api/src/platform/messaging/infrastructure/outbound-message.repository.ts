import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type MessageChannel, type MessagePurpose, type MessageStatus, type OutboundMessage } from '@prisma/client';

/** A tenant client or an open transaction. */
export type Db = Prisma.TransactionClient | PrismaClient;

export interface NewOutboundMessage {
  organizationId: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  clientId: string | null;
  recipient: string;
  resourceType: string;
  resourceId: string;
  templateName: string | null;
  templateLanguage: string | null;
  idempotencyKey: string;
  createdBy: string;
}

/** Tenant DB access for OutboundMessage (ADR-042 phase 2). */
@Injectable()
export class OutboundMessageRepository {
  findByKey(db: Db, organizationId: string, idempotencyKey: string): Promise<OutboundMessage | null> {
    return db.outboundMessage.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
  }

  findById(db: Db, id: string): Promise<OutboundMessage | null> {
    return db.outboundMessage.findUnique({ where: { id } });
  }

  findByProviderId(db: Db, providerMessageId: string): Promise<OutboundMessage | null> {
    return db.outboundMessage.findUnique({ where: { providerMessageId } });
  }

  /** Throws Prisma P2002 when (organizationId, idempotencyKey) already exists. */
  create(db: Db, data: NewOutboundMessage): Promise<OutboundMessage> {
    return db.outboundMessage.create({ data: { ...data, status: 'QUEUED' } });
  }

  /**
   * Re-arms a FAILED row for a retry. Conditional on it still being FAILED, so two concurrent
   * retries cannot both send: the loser gets `false`.
   */
  async rearmFailed(
    db: Db,
    id: string,
    data: Pick<NewOutboundMessage, 'recipient' | 'clientId' | 'templateName' | 'templateLanguage' | 'createdBy'>,
  ): Promise<boolean> {
    const { count } = await db.outboundMessage.updateMany({
      where: { id, status: 'FAILED' },
      data: {
        ...data,
        status: 'QUEUED',
        queuedAt: new Date(),
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        providerMessageId: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
      },
    });
    return count === 1;
  }

  /**
   * Stores Meta's message id on the still-QUEUED row the moment Meta accepts it — before the
   * platform route is written — so a webhook that beats `markSent` already finds the row.
   */
  async attachProviderId(db: Db, id: string, providerMessageId: string): Promise<boolean> {
    const { count } = await db.outboundMessage.updateMany({
      where: { id, status: 'QUEUED', providerMessageId: null },
      data: { providerMessageId },
    });
    return count === 1;
  }

  /**
   * QUEUED → SENT. A webhook may already have moved the row further (DELIVERED / READ / FAILED):
   * that status is kept and only a missing `sentAt` is filled.
   */
  async markSent(db: Db, id: string, providerMessageId: string, sentAt: Date): Promise<OutboundMessage> {
    await db.outboundMessage.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'SENT', providerMessageId, sentAt } });
    await db.outboundMessage.updateMany({ where: { id, sentAt: null, status: { not: 'FAILED' } }, data: { sentAt } });
    return db.outboundMessage.findUniqueOrThrow({ where: { id } });
  }

  /** The send went out but Meta never confirmed it: not FAILED, so never auto-retried. */
  markUnknown(db: Db, id: string, errorCode: string, errorMessage: string): Promise<OutboundMessage> {
    return db.outboundMessage.update({ where: { id }, data: { status: 'UNKNOWN', errorCode, errorMessage } });
  }

  markFailed(db: Db, id: string, errorCode: string, errorMessage: string, failedAt: Date): Promise<OutboundMessage> {
    return db.outboundMessage.update({ where: { id }, data: { status: 'FAILED', errorCode, errorMessage, failedAt } });
  }

  /**
   * Applies a webhook status only when the row is in one of `from` (the monotonic guard, evaluated
   * by the database so concurrent webhooks cannot regress a status). Returns whether it applied.
   */
  async applyStatus(
    db: Db,
    providerMessageId: string,
    from: MessageStatus[],
    data: Prisma.OutboundMessageUpdateManyMutationInput,
  ): Promise<boolean> {
    if (from.length === 0) return false;
    const { count } = await db.outboundMessage.updateMany({
      where: { providerMessageId, status: { in: from } },
      data,
    });
    return count > 0;
  }

  /** After a jump ahead (READ before DELIVERED), fills the skipped timestamps that are still null. */
  async fillMissingTimestamps(db: Db, providerMessageId: string, fields: Array<'sentAt' | 'deliveredAt'>, at: Date): Promise<void> {
    for (const field of fields) {
      await db.outboundMessage.updateMany({ where: { providerMessageId, [field]: null }, data: { [field]: at } });
    }
  }

  /** Rows in `statuses` queued before `before`, oldest first. */
  listStale(db: Db, organizationId: string, statuses: MessageStatus[], before: Date): Promise<OutboundMessage[]> {
    return db.outboundMessage.findMany({
      where: { organizationId, status: { in: statuses }, queuedAt: { lt: before } },
      orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
    });
  }

  listForResource(db: Db, organizationId: string, resourceType: string, resourceId: string): Promise<OutboundMessage[]> {
    return db.outboundMessage.findMany({
      where: { organizationId, resourceType, resourceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
