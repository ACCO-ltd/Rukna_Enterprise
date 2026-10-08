import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import { tenancyStorage } from '../tenancy/tenancy.context.js';
import { CommunicationService, type DispatchSummary } from './communication.service.js';

/**
 * ADR-044 phase 2 — the background sender. Every minute, for every ACTIVE tenant (inside that
 * tenant's AsyncLocalStorage, the ADR-031 Decision 3 pattern), sends the QUEUED background messages
 * that are due (`CommunicationService.dispatchDue`). Client messages (invoices, receipts) are sent
 * synchronously and never have `nextAttemptAt`, so this never touches them.
 *
 * Skips quietly (one log line) while WhatsApp is not configured on the server: rows stay QUEUED and
 * go out once it is (or expire after BACKGROUND_MAX_AGE_MS). Runs never overlap in one process;
 * across processes the per-row claim (lease) keeps a message from being sent twice.
 */
@Injectable()
export class OutboundMessageDispatcher {
  private readonly logger = new Logger(OutboundMessageDispatcher.name);
  private running = false;
  private warnedUnconfigured = false;

  constructor(
    private readonly platformPrisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly communication: CommunicationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.dispatchAllTenants();
    } catch (error) {
      this.logger.error(`Background message dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * One pass over every ACTIVE tenant. Public for a manual trigger or a spec. `now` pins the clock
   * for tests only; otherwise each claim reads the time itself (review M1).
   */
  async dispatchAllTenants(now?: Date): Promise<DispatchSummary> {
    const total: DispatchSummary = { sent: 0, retrying: 0, failed: 0, unknown: 0, cancelled: 0 };
    if (!this.communication.isWhatsAppConfigured()) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        this.logger.log('WhatsApp is not configured on this server — background messages stay queued');
      }
      return total;
    }
    this.warnedUnconfigured = false;

    const tenants = await this.platformPrisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { slug: true } });
    for (const { slug } of tenants) {
      try {
        const ctx = await this.tenancy.resolveTenant(slug);
        const summary = await tenancyStorage.run(ctx, () => this.communication.dispatchDue(now));
        for (const key of Object.keys(total) as Array<keyof DispatchSummary>) total[key] += summary[key];
        if (Object.values(summary).some((n) => n > 0)) {
          this.logger.log(`Background messages for ${slug}: ${JSON.stringify(summary)}`);
        }
      } catch (error) {
        // One bad tenant must not stop the others.
        this.logger.error(
          `Background message dispatch failed for tenant ${slug}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return total;
  }
}
