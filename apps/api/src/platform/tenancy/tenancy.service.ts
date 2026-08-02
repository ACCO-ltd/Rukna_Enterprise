import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { tenancyStorage, TenantContext } from './tenancy.context.js';

const MAX_CACHED_CLIENTS = 50;

@Injectable()
export class TenancyService implements OnApplicationShutdown {
  private readonly logger = new Logger(TenancyService.name);
  // Insertion-ordered Map — keys at the front are least-recently-used.
  private readonly clients = new Map<string, PrismaClient>();

  constructor(private readonly platformPrisma: PrismaService) {}

  async resolveTenant(slug: string): Promise<TenantContext> {
    const tenant = await this.platformPrisma.tenant.findUnique({ where: { slug } });

    if (!tenant) throw new NotFoundException(`Tenant '${slug}' not found`);
    if (tenant.status === 'SUSPENDED') throw new NotFoundException(`Tenant '${slug}' is suspended`);
    if (tenant.status === 'TERMINATED') throw new NotFoundException(`Tenant '${slug}' is terminated`);

    const client = this.getOrCreateClient(slug, tenant.dbUrl);
    return { tenantId: tenant.id, tenantSlug: slug, client };
  }

  getClient(): PrismaClient {
    const ctx = tenancyStorage.getStore();
    if (!ctx) {
      throw new InternalServerErrorException(
        'TenancyService.getClient() called outside of a tenant request context',
      );
    }
    return ctx.client;
  }

  async onApplicationShutdown(): Promise<void> {
    const disconnects = [...this.clients.values()].map((c) => c.$disconnect());
    await Promise.all(disconnects);
    this.clients.clear();
    this.logger.log('All tenant Prisma clients disconnected');
  }

  // ─── LRU helpers ──────────────────────────────────────────────────────────────

  private getOrCreateClient(slug: string, dbUrl: string): PrismaClient {
    if (this.clients.has(slug)) {
      // Refresh LRU position: delete then re-insert moves key to end of insertion order.
      const existing = this.clients.get(slug)!;
      this.clients.delete(slug);
      this.clients.set(slug, existing);
      return existing;
    }

    if (this.clients.size >= MAX_CACHED_CLIENTS) {
      // Evict the least-recently-used entry (first key in insertion order).
      const lruSlug = this.clients.keys().next().value as string;
      const lruClient = this.clients.get(lruSlug)!;
      this.clients.delete(lruSlug);
      this.logger.log(`LRU evict tenant client: ${lruSlug}`);
      lruClient.$disconnect().catch(() => undefined);
    }

    this.logger.log(`Creating Prisma client for tenant: ${slug}`);
    const client = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    this.clients.set(slug, client);
    return client;
  }
}
