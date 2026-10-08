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
  QUOTE_READY: 'WHATSAPP_TEMPLATE_QUOTE_READY',
  QUOTE_REMINDER: 'WHATSAPP_TEMPLATE_QUOTE_REMINDER',
  QUOTE_ESCALATION: 'WHATSAPP_TEMPLATE_QUOTE_ESCALATION',
  QUOTE_CHOSEN: 'WHATSAPP_TEMPLATE_QUOTE_CHOSEN',
  QUOTE_ANOTHER: 'WHATSAPP_TEMPLATE_QUOTE_ANOTHER',
};

/**
 * ADR-044 phase 2 — the staff alert templates have fixed default names (the ones submitted to
 * Meta); the env variable only overrides. Client templates have no default: unset = not configured.
 */
export const WHATSAPP_TEMPLATE_DEFAULT_NAME: Partial<Record<MessagePurpose, string>> = {
  QUOTE_READY: 'quote_ready_so',
  QUOTE_REMINDER: 'quote_reminder_so',
  QUOTE_ESCALATION: 'quote_escalation_so',
  QUOTE_CHOSEN: 'quote_chosen_so',
  QUOTE_ANOTHER: 'quote_another_so',
};

/** The staff alert purposes (Somali text, registered at Meta under language `en`). */
export const STAFF_ALERT_PURPOSES: ReadonlySet<MessagePurpose> = new Set(
  Object.keys(WHATSAPP_TEMPLATE_DEFAULT_NAME) as MessagePurpose[],
);

export const WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE = 'en';

export interface WhatsAppTemplateRef {
  name: string;
  language: string;
}

/**
 * The template for a purpose, or null when its name is not configured on this server.
 *
 * Language: client templates use WHATSAPP_TEMPLATE_LANGUAGE; the Somali staff alerts use
 * WHATSAPP_TEMPLATE_QUOTE_LANGUAGE (Somali is not a Meta template language, so they are registered
 * under `en`) — both default to `en`.
 */
export function resolveWhatsAppTemplate(config: ConfigService, purpose: MessagePurpose): WhatsAppTemplateRef | null {
  const name = config.get<string>(WHATSAPP_TEMPLATE_ENV[purpose])?.trim() || WHATSAPP_TEMPLATE_DEFAULT_NAME[purpose];
  if (!name) return null;
  const languageEnv = STAFF_ALERT_PURPOSES.has(purpose) ? 'WHATSAPP_TEMPLATE_QUOTE_LANGUAGE' : 'WHATSAPP_TEMPLATE_LANGUAGE';
  const language = config.get<string>(languageEnv)?.trim() || WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE;
  return { name, language };
}
