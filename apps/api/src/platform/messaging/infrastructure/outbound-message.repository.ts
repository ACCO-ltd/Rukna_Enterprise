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

  markSent(db: Db, id: string, providerMessageId: string, sentAt: Date): Promise<OutboundMessage> {
    return db.outboundMessage.update({ where: { id }, data: { status: 'SENT', providerMessageId, sentAt } });
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

  listForResource(db: Db, organizationId: string, resourceType: string, resourceId: string): Promise<OutboundMessage[]> {
    return db.outboundMessage.findMany({
      where: { organizationId, resourceType, resourceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
