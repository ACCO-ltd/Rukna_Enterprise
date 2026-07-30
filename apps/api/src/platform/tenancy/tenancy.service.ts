import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { tenancyStorage, TenancyContext } from './tenancy.context.js';

@Injectable()
export class TenancyService {
  private readonly logger = new Logger(TenancyService.name);
  private readonly clients = new Map<string, PrismaClient>();

  constructor(private readonly platformPrisma: PrismaService) {}

  async resolveTenant(slug: string): Promise<TenancyContext> {
    const tenant = await this.platformPrisma.tenant.findUnique({ where: { slug } });

    if (!tenant) {
      throw new NotFoundException(`Tenant '${slug}' not found`);
    }

    if (tenant.status === 'SUSPENDED') {
      throw new NotFoundException(`Tenant '${slug}' is suspended`);
    }

    if (tenant.status === 'TERMINATED') {
      throw new NotFoundException(`Tenant '${slug}' is terminated`);
    }

    const client = this.getOrCreateClient(slug, tenant.dbUrl);

    return { slug, orgId: '', client, lang: 'en' };
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

  getContext(): TenancyContext {
    const ctx = tenancyStorage.getStore();
    if (!ctx) {
      throw new InternalServerErrorException(
        'TenancyService.getContext() called outside of a tenant request context',
      );
    }
    return ctx;
  }

  private getOrCreateClient(slug: string, dbUrl: string): PrismaClient {
    if (!this.clients.has(slug)) {
      this.logger.log(`Creating Prisma client for tenant: ${slug}`);
      const client = new PrismaClient({ datasources: { db: { url: dbUrl } } });
      this.clients.set(slug, client);
    }
    return this.clients.get(slug)!;
  }
}
