import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { OutboundMessage } from '@prisma/client';

import { CommunicationService, type DispatchDecision } from '../../../../platform/messaging/communication.service.js';
import { E164_PATTERN } from '../../../../platform/messaging/domain/message-status.js';
import { QuotationRequestRepository, type Db } from '../infrastructure/quotation-request.repository.js';
import {
  QUOTATION_MESSAGE_RESOURCE,
  alertStillWanted,
  type QuotationAlertPurpose,
} from '../domain/quotation-whatsapp.policy.js';
import { QuotationNotifier } from './quotation-notifier.service.js';
import { QuotationWhatsAppAlerts } from './quotation-whatsapp-alerts.service.js';

/**
 * ADR-044 phase 2, review M2 — the last check before the dispatcher sends a quotation alert
 * (registered as the platform's DispatchGuard for `quotation_request`). Everything is re-read, since
 * the alert may have waited minutes (retries) between queueing and sending:
 *
 *   1. the kill switch is still on;
 *   2. the request is still in the alert's round (alertStillWanted: same send / award / return);
 *   3. the recipient is still an ACTIVE user with an ACTIVE membership of the organisation, still
 *      opted in, still has a valid number — a changed number is used, a removed one drops the alert;
 *   4. the recipient is still in the alert's audience: a selector (award holder who can reach the
 *      project and is not SoD-barred) for ready / reminder, a CFO / CEO with project access for the
 *      escalation, a collector of the request for chosen / another.
 */
@Injectable()
export class QuotationAlertGuard implements OnModuleInit {
  constructor(
    private readonly communication: CommunicationService,
    private readonly alerts: QuotationWhatsAppAlerts,
    private readonly repo: QuotationRequestRepository,
    private readonly notifier: QuotationNotifier,
  ) {}

  onModuleInit(): void {
    this.communication.registerDispatchGuard(QUOTATION_MESSAGE_RESOURCE, (db, message) => this.check(db, message));
  }

  async check(db: Db, message: OutboundMessage): Promise<DispatchDecision> {
    if (!this.alerts.switchedOn()) return 'Not sent: quotation WhatsApp alerts were switched off.';
    const purpose = message.purpose as QuotationAlertPurpose;
    const request = await this.repo.findById(db, message.organizationId, message.resourceId);
    const stale = alertStillWanted(purpose, message.idempotencyKey, request);
    if (stale) return stale;
    if (!request || !message.recipientUserId) return 'Not sent: the recipient is unknown.';

    const user = await db.user.findFirst({
      where: {
        id: message.recipientUserId,
        status: 'ACTIVE',
        memberships: { some: { organizationId: message.organizationId, status: 'ACTIVE', removedAt: null } },
      },
      select: { whatsappPhone: true, whatsappAlertsEnabled: true },
    });
    if (!user) return 'Not sent: the recipient is no longer an active member.';
    if (!user.whatsappAlertsEnabled) return 'Not sent: the recipient turned WhatsApp alerts off.';
    if (!user.whatsappPhone || !E164_PATTERN.test(user.whatsappPhone)) {
      return 'Not sent: the recipient no longer has a WhatsApp number.';
    }

    const audience = await this.audience(db, purpose, request);
    if (!audience.includes(message.recipientUserId)) return 'Not sent: the recipient can no longer act on this request.';
    return user.whatsappPhone === message.recipient ? null : { recipient: user.whatsappPhone };
  }

  private async audience(
    db: Db,
    purpose: QuotationAlertPurpose,
    request: NonNullable<Awaited<ReturnType<QuotationRequestRepository['findById']>>>,
  ): Promise<string[]> {
    if (purpose === 'QUOTE_ESCALATION') return this.notifier.escalationIdsFor(db, request);
    if (purpose === 'QUOTE_READY' || purpose === 'QUOTE_REMINDER') {
      const mr = await this.repo.findMaterialRequest(db, request.organizationId, request.materialRequestId);
      return mr ? this.notifier.selectorIdsFor(db, request, mr.requestedBy) : [];
    }
    return this.notifier.collectorIdsFor(request);
  }
}
