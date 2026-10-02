import { Module } from '@nestjs/common';

import { WhatsAppWebhookController } from './whatsapp-webhook.controller.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

/** ADR-042 — WhatsApp Cloud API. Today: the webhook. Sending arrives with "send invoice by WhatsApp". */
@Module({
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppWebhookService],
  exports: [WhatsAppWebhookService],
})
export class WhatsAppModule {}
