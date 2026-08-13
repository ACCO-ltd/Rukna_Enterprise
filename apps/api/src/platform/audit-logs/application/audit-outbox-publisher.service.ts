import { Injectable } from '@nestjs/common';
import { TenancyService } from '../../tenancy/tenancy.service.js';

export interface AuditOutboxPublisher {
  publish(event: { id: string; eventType: string; idempotencyKey: string; payload: unknown }): Promise<void>;
}

/**
 * The invoking worker must run after commit. Retrying an unpublished event is
 * safe because consumers receive the durable idempotency key.
 */
@Injectable()
export class AuditOutboxPublisherService {
  constructor(private readonly tenancyService: TenancyService) {}

  async publishPending(organizationId: string, publisher: AuditOutboxPublisher, limit = 100): Promise<number> {
    const prisma = this.tenancyService.getClient();
    const events = await prisma.auditOutboxEvent.findMany({
      where: { organizationId, publishedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: limit,
    });

    let published = 0;
    for (const event of events) {
      try {
        await publisher.publish({
          id: event.id,
          eventType: event.eventType,
          idempotencyKey: event.idempotencyKey,
          payload: event.payload,
        });
        await prisma.auditOutboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), publishAttempts: { increment: 1 }, lastError: null },
        });
        published += 1;
      } catch (error) {
        await prisma.auditOutboxEvent.update({
          where: { id: event.id },
          data: {
            publishAttempts: { increment: 1 },
            lastError: error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown publish error',
          },
        });
      }
    }
    return published;
  }
}
