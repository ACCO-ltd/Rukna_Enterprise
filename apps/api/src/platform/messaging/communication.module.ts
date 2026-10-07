import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { WhatsAppModule } from './whatsapp/whatsapp.module.js';
import { WhatsAppWebhookController } from './whatsapp/whatsapp-webhook.controller.js';
import { WhatsAppWebhookService } from './whatsapp/whatsapp-webhook.service.js';
import { CommunicationService } from './communication.service.js';
import { CommunicationsController } from './presentation/communications.controller.js';
import { OutboundMessageDispatcher } from './outbound-message-dispatcher.service.js';
import { OutboundMessageRepository } from './infrastructure/outbound-message.repository.js';
import { OutboundMessageRouteRepository } from './infrastructure/outbound-message-route.repository.js';

/**
 * ADR-042 phase 2 — the communication core: OutboundMessage records, sending through the WhatsApp
 * client, and the webhook that keeps their status. Feature modules (send invoice / receipt /
 * reminders) import this and call CommunicationService.
 */
@Module({
  imports: [TenancyModule, AuditLogsModule, WhatsAppModule],
  controllers: [WhatsAppWebhookController, CommunicationsController],
  providers: [
    CommunicationService,
    WhatsAppWebhookService,
    OutboundMessageRepository,
    OutboundMessageRouteRepository,
    // ADR-044 phase 2 — background sender (cron, every minute, all tenants).
    OutboundMessageDispatcher,
  ],
  exports: [CommunicationService, OutboundMessageRepository, WhatsAppModule],
})
export class CommunicationModule {}
