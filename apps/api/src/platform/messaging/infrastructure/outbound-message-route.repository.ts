import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';

/**
 * Platform DB: provider message id → tenant (ADR-042 phase 2). The public webhook carries no
 * tenant subdomain, so this is how a status update finds the tenant DB that holds the message.
 */
@Injectable()
export class OutboundMessageRouteRepository {
  constructor(private readonly platform: PrismaService) {}

  /** Idempotent: a repeat for the same message id keeps the first tenant. */
  async record(providerMessageId: string, tenantId: string): Promise<void> {
    await this.platform.outboundMessageRoute.upsert({
      where: { providerMessageId },
      create: { providerMessageId, tenantId },
      update: {},
    });
  }

  /** The slug of the tenant that sent this message, or null when unknown. */
  async findTenantSlug(providerMessageId: string): Promise<string | null> {
    const route = await this.platform.outboundMessageRoute.findUnique({
      where: { providerMessageId },
      select: { tenant: { select: { slug: true } } },
    });
    return route?.tenant.slug ?? null;
  }
}
