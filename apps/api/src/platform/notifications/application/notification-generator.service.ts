import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PrismaClient } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service.js';
import { TenancyService } from '../../tenancy/tenancy.service.js';
import { tenancyStorage } from '../../tenancy/tenancy.context.js';
import type { INotificationRepository } from '../domain/notification-repository.interface.js';
import { NotificationRecipientService } from './notification-recipient.service.js';
import { StagePaymentSource } from './notification-sources/stage-payment.source.js';
import { ClientInvoiceOverdueSource } from './notification-sources/client-invoice-overdue.source.js';
import type { NotificationSource } from './notification-sources/notification-source.js';

/**
 * ADR-031 — the daily notification generator. Runs outside any HTTP request, so it establishes tenant
 * context itself (TenancyService.getClient() throws outside a request): it walks ACTIVE tenants, runs
 * each org cycle inside that tenant's AsyncLocalStorage, and per org does two passes per source —
 * AUTO-RESOLVE (close rows whose condition cleared) then GENERATE (idempotent upsert per recipient).
 *
 * Ships dark: gated by NOTIFICATIONS_GENERATION_ENABLED (default false). `generateAllTenants()` is
 * public so a manual trigger or a spec can run the body without waiting for the cron.
 */
@Injectable()
export class NotificationGeneratorService {
  private readonly logger = new Logger(NotificationGeneratorService.name);
  private readonly sources: NotificationSource<{ resourceId: string; projectId: string | null }>[];

  constructor(
    private readonly platformPrisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly configService: ConfigService,
    private readonly recipients: NotificationRecipientService,
    stagePaymentSource: StagePaymentSource,
    clientInvoiceOverdueSource: ClientInvoiceOverdueSource,
    @Inject('INotificationRepository')
    private readonly repository: INotificationRepository,
  ) {
    // Registration point: a new notification kind is added here (plus its source file) and nowhere else.
    this.sources = [stagePaymentSource, clientInvoiceOverdueSource];
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleDailyCron(): Promise<void> {
    if (this.configService.get('NOTIFICATIONS_GENERATION_ENABLED') !== 'true') {
      return;
    }
    try {
      await this.generateAllTenants();
    } catch (error) {
      this.logger.error(
        `Notification generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Run one full generation cycle across every ACTIVE tenant. Public so it can be triggered manually or
   * from a spec. `now` is injectable for deterministic testing.
   */
  async generateAllTenants(now: Date = new Date()): Promise<void> {
    const tenants = await this.platformPrisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { slug: true },
    });

    for (const { slug } of tenants) {
      try {
        const ctx = await this.tenancy.resolveTenant(slug);
        await tenancyStorage.run(ctx, async () => {
          const prisma = this.tenancy.getClient();
          const orgs = await prisma.organization.findMany({ select: { id: true } });
          for (const { id: orgId } of orgs) {
            await this.runOrgCycle(prisma, orgId, now);
          }
        });
      } catch (error) {
        // One bad tenant must not stop the others.
        this.logger.error(
          `Notification generation failed for tenant ${slug}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * One org's cycle: for each source, auto-resolve stale rows, then generate live ones. Auto-resolve
   * runs first so a condition that both cleared and re-armed in the same tick ends up armed, not closed.
   */
  private async runOrgCycle(prisma: PrismaClient, organizationId: string, now: Date): Promise<void> {
    for (const source of this.sources) {
      const conditions = await source.findLiveConditions(prisma, organizationId, now);

      // (1) AUTO-RESOLVE — close any open row of this resourceType whose dedupeKey is no longer live.
      // Keying on the live dedupeKeys (not resourceIds) also closes a SUPERSEDED row when a still-live
      // resource changes key (a stage that slips DUE→OVERDUE, an invoice that ages into a new band), so
      // the same condition never stacks two open notifications.
      const liveDedupeKeys = [...new Set(conditions.map((condition) => source.toDedupeKey(condition)))];
      await this.repository.autoResolveMissing(organizationId, source.resourceType, liveDedupeKeys);

      // (2) GENERATE — one idempotent upsert per recipient per live condition.
      for (const condition of conditions) {
        const recipientUserIds = await this.resolveRecipients(prisma, organizationId, condition.projectId);
        for (const recipientUserId of recipientUserIds) {
          await this.repository.upsertByDedupeKey(
            source.toRow(condition, recipientUserId, organizationId),
          );
        }
      }
    }
  }

  /**
   * Recipients for a condition. Project-scoped conditions resolve to the project's audience; a
   * project-less condition (an org-level overdue invoice) has no project audience to key on, so it is
   * best-effort skipped rather than crashing — under-notifying is the safe direction (TODO(Eng Ahmed):
   * decide the org-level fallback audience for project-less invoices — likely FINANCE_CONTROLLER holders).
   */
  private async resolveRecipients(
    prisma: PrismaClient,
    organizationId: string,
    projectId: string | null,
  ): Promise<string[]> {
    if (!projectId) return [];
    return this.recipients.resolveForProject(prisma, organizationId, projectId);
  }
}
