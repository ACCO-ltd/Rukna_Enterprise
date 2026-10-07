import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../../platform/database/prisma.service.js';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { tenancyStorage } from '../../../../platform/tenancy/tenancy.context.js';
import { errorCode } from '../../../../platform/messaging/communication.service.js';
import { QuotationRequestRepository } from '../infrastructure/quotation-request.repository.js';
import {
  QUOTATION_MESSAGE_RESOURCE,
  decisionRound,
  roundOfKey,
  slaAlertsDue,
  slaChaseFrom,
} from '../domain/quotation-whatsapp.policy.js';
import { QuotationNotifier } from './quotation-notifier.service.js';
import { QuotationWhatsAppAlerts } from './quotation-whatsapp-alerts.service.js';

export interface SlaRunSummary {
  checked: number;
  remindersQueued: number;
  escalationsQueued: number;
}

/**
 * ADR-044 §10 / phase 2 — the quotation SLA chaser. Every 5 minutes, for every ACTIVE tenant and
 * organisation (ADR-031 Decision 3: its own tenant context via `tenancyStorage.run`), looks at the
 * requests AWAITING_DECISION and queues, once per decision round and recipient:
 *
 *   ≥ 2 working hours → QUOTE_REMINDER to the selectors (award holders with project access, minus
 *                       the SoD-barred — the in-app QUOTES_READY audience)
 *   ≥ 4 working hours → QUOTE_ESCALATION to the CFO and CEO role holders with project access
 *
 * Working hours = Sat–Thu 07:00–17:00 Mogadishu; urgent requests count clock hours. A non-urgent
 * request is never chased outside working hours. Idempotency keys carry the round, so a repeat run
 * queues nothing new; a re-send after "ask another" or a re-decision starts a new round. Does
 * nothing while QUOTATION_WHATSAPP_ENABLED is off or WhatsApp is not configured. WhatsApp only —
 * the in-app inbox already colours the waiting time.
 */
@Injectable()
export class QuotationSlaAlertJob {
  private readonly logger = new Logger(QuotationSlaAlertJob.name);
  private running = false;

  constructor(
    private readonly platformPrisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly repo: QuotationRequestRepository,
    private readonly notifier: QuotationNotifier,
    private readonly alerts: QuotationWhatsAppAlerts,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    if (this.running || !this.alerts.enabled()) return;
    this.running = true;
    try {
      await this.runAllTenants();
    } catch (error) {
      this.logger.error(`Quotation SLA run failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** One pass over every ACTIVE tenant. Public for a manual trigger or a spec. */
  async runAllTenants(now: Date = new Date()): Promise<SlaRunSummary> {
    const total: SlaRunSummary = { checked: 0, remindersQueued: 0, escalationsQueued: 0 };
    if (!this.alerts.enabled()) return total;
    const tenants = await this.platformPrisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { slug: true } });
    for (const { slug } of tenants) {
      try {
        const ctx = await this.tenancy.resolveTenant(slug);
        const summary = await tenancyStorage.run(ctx, () => this.runTenant(now));
        total.checked += summary.checked;
        total.remindersQueued += summary.remindersQueued;
        total.escalationsQueued += summary.escalationsQueued;
      } catch (error) {
        // One bad tenant must not stop the others.
        this.logger.error(`Quotation SLA run failed for tenant ${slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return total;
  }

  /** One tenant, in its context. */
  async runTenant(now: Date = new Date()): Promise<SlaRunSummary> {
    const summary: SlaRunSummary = { checked: 0, remindersQueued: 0, escalationsQueued: 0 };
    const prisma = this.tenancy.getClient();
    // Review M3: only rounds sent within the lookback (and after QUOTATION_WHATSAPP_SINCE).
    const from = slaChaseFrom(now, this.alerts.chaseSince());
    const waiting = await prisma.quotationRequest.findMany({
      where: { status: 'AWAITING_DECISION', sentAt: { gte: from } },
      select: { id: true, organizationId: true, status: true, sentAt: true, urgent: true, sendCount: true },
      orderBy: { sentAt: 'asc' },
    });
    const candidates = waiting
      .map((request) => ({ request, due: slaAlertsDue(request, now) }))
      .filter(({ due }) => due.reminder || due.escalation);
    summary.checked = waiting.length;
    // Review M3: a round whose due alerts already exist is finished — no transaction, no lookups.
    const queued = new Set(
      (
        await prisma.outboundMessage.findMany({
          where: {
            resourceType: QUOTATION_MESSAGE_RESOURCE,
            resourceId: { in: candidates.map((c) => c.request.id) },
            purpose: { in: ['QUOTE_REMINDER', 'QUOTE_ESCALATION'] },
          },
          select: { resourceId: true, purpose: true, idempotencyKey: true },
        })
      ).map((m) => `${m.resourceId}|${m.purpose}|${roundOfKey(m.idempotencyKey)}`),
    );
    for (const { request: candidate, due: scanned } of candidates) {
      const round = decisionRound(candidate);
      const has = (purpose: string) => queued.has(`${candidate.id}|${purpose}|${round}`);
      if ((!scanned.reminder || has('QUOTE_REMINDER')) && (!scanned.escalation || has('QUOTE_ESCALATION'))) continue;
      try {
        await prisma.$transaction(async (tx) => {
          // Review L6: decide from the locked, in-transaction read, not the scan.
          const request = await this.repo.lockById(tx, candidate.organizationId, candidate.id);
          if (!request || !request.sentAt || request.sentAt < from) return;
          const due = slaAlertsDue(request, now);
          if (!due.reminder && !due.escalation) return;
          const mr = await this.repo.findMaterialRequest(tx, request.organizationId, request.materialRequestId);
          if (!mr) return;
          const facts = { ...(await this.notifier.alertFacts(tx, request, mr.mrNumber)), waitingMinutes: due.waitingMinutes };
          const base = {
            organizationId: request.organizationId,
            requestId: request.id,
            round: decisionRound(request),
            facts,
            actorUserId: request.createdBy,
          };
          if (due.reminder) {
            summary.remindersQueued += await this.alerts.queue(tx, {
              ...base,
              purpose: 'QUOTE_REMINDER',
              recipientUserIds: await this.notifier.selectorIdsFor(tx, request, mr.requestedBy),
            });
          }
          if (due.escalation) {
            summary.escalationsQueued += await this.alerts.queue(tx, {
              ...base,
              purpose: 'QUOTE_ESCALATION',
              recipientUserIds: await this.notifier.escalationIdsFor(tx, request),
            });
          }
        });
      } catch (error) {
        this.logger.error(`Quotation SLA check of ${candidate.id} failed: ${errorCode(error)}`);
      }
    }
    return summary;
  }
}
