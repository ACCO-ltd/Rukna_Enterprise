import { Module } from '@nestjs/common';

import { WhatsAppClient } from './whatsapp.client.js';

/**
 * ADR-042 — the WhatsApp Cloud API client (the only code that calls graph.facebook.com). The webhook
 * and message records live in CommunicationModule, which imports this.
 */
@Module({
  providers: [WhatsAppClient],
  exports: [WhatsAppClient],
})
export class WhatsAppModule {}
