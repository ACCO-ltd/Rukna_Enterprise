import type { ConfigService } from '@nestjs/config';
import type { MessagePurpose } from '@prisma/client';

/**
 * ADR-042 phase 2 — which Meta-approved template each message purpose uses. Template names are set
 * per server (they are whatever the owner had approved in Meta), never hard-coded. Texts:
 * docs/integrations/whatsapp-templates.md.
 */
export const WHATSAPP_TEMPLATE_ENV: Record<MessagePurpose, string> = {
  INVOICE: 'WHATSAPP_TEMPLATE_INVOICE',
  RECEIPT: 'WHATSAPP_TEMPLATE_RECEIPT',
  PAYMENT_REMINDER: 'WHATSAPP_TEMPLATE_PAYMENT_REMINDER',
  OVERDUE_REMINDER: 'WHATSAPP_TEMPLATE_OVERDUE_REMINDER',
};

export const WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE = 'en';

export interface WhatsAppTemplateRef {
  name: string;
  language: string;
}

/** The template for a purpose, or null when its name is not configured on this server. */
export function resolveWhatsAppTemplate(config: ConfigService, purpose: MessagePurpose): WhatsAppTemplateRef | null {
  const name = config.get<string>(WHATSAPP_TEMPLATE_ENV[purpose])?.trim();
  if (!name) return null;
  const language = config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE')?.trim() || WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE;
  return { name, language };
}
