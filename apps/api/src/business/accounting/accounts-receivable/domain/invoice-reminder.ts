import type { WhatsAppReminderKind, WhatsAppSendBlockedReason } from '@erp/types';

import { daysPastDue } from '../../../../platform/clients/domain/client-rules.js';
import { formatMessageAmount } from '../../../../platform/messaging/whatsapp/whatsapp-send-preview.js';
import { formatTemplateDate } from './invoice-whatsapp.js';

/**
 * ADR-042 — WhatsApp V1 step 4: a MANUAL payment / overdue reminder for one client invoice, sent
 * through the Meta-approved PAYMENT_REMINDER / OVERDUE_REMINDER templates (text only, no document;
 * docs/integrations/whatsapp-templates.md). Pure rules: no Prisma, no Nest.
 *
 * No second reminder engine: "overdue" is the collection rule every other screen uses
 * (`daysPastDue` — whole UTC calendar days past the due date; overdue from the day after it).
 */

/** OVERDUE_REMINDER once the due date has passed, else PAYMENT_REMINDER (also with no due date). */
export function reminderKind(dueDate: Date | null, asOf: Date): WhatsAppReminderKind {
  return dueDate && daysPastDue(dueDate, asOf) > 0 ? 'OVERDUE_REMINDER' : 'PAYMENT_REMINDER';
}

/** Whole days past the due date; 0 when not yet due or no due date. */
export function reminderDaysPastDue(dueDate: Date | null, asOf: Date): number {
  return dueDate ? Math.max(0, daysPastDue(dueDate, asOf)) : 0;
}

/** True when the decimal string is more than zero (no float: "0.00", "-5.00" → false). */
export function hasOutstanding(outstandingAmount: string): boolean {
  const text = outstandingAmount.trim();
  if (text.startsWith('-')) return false;
  return /[1-9]/.test(text.replace(/^\+/, ''));
}

export interface ReminderTemplateFacts {
  clientName: string;
  invoiceNumber: string;
  /** Decimal string — the amount still outstanding (not the invoice total). */
  outstandingAmount: string;
  currencyCode: string;
  dueDate: Date | null;
  companyName: string;
}

/**
 * The template body values, in order — part of the contract with the templates approved in Meta,
 * never reorder: {{1}} client · {{2}} invoice number · {{3}} amount outstanding · {{4}} due date ·
 * {{5}} company.
 */
export function buildReminderBodyParams(facts: ReminderTemplateFacts): string[] {
  return [
    facts.clientName.trim(),
    facts.invoiceNumber,
    formatMessageAmount(facts.outstandingAmount, facts.currencyCode),
    formatTemplateDate(facts.dueDate),
    facts.companyName.trim(),
  ];
}

/**
 * The first reason a reminder cannot go (null when it can): the record (reversed, not issued,
 * nothing owed), then who to send to, then the server's WhatsApp set-up.
 */
export function reminderBlockedReason(state: {
  issued: boolean;
  reversed: boolean;
  outstanding: boolean;
  recipient: string | null;
  templateConfigured: boolean;
  whatsappConfigured: boolean;
}): WhatsAppSendBlockedReason | null {
  if (state.reversed) return 'REVERSED';
  if (!state.issued) return 'NOT_POSTED';
  if (!state.outstanding) return 'NOTHING_OUTSTANDING';
  if (!state.recipient) return 'NO_RECIPIENT';
  if (!state.templateConfigured) return 'TEMPLATE_NOT_CONFIGURED';
  if (!state.whatsappConfigured) return 'WHATSAPP_NOT_CONFIGURED';
  return null;
}

/** Plain words for each refusal (the API's error message). */
export const REMINDER_REFUSAL_MESSAGE: Record<
  WhatsAppSendBlockedReason | 'RECIPIENT_INVALID' | 'COMPANY_NAME_MISSING',
  string
> = {
  NOT_POSTED: 'Only an issued invoice can be chased. Issue the invoice first.',
  REVERSED: 'This invoice has been reversed, so there is nothing to remind the client about.',
  NOTHING_OUTSTANDING:
    'This invoice is fully paid, so there is nothing to remind the client about.',
  WHATSAPP_NOT_CONFIGURED:
    'WhatsApp sending is not set up on this server. Ask an administrator to connect WhatsApp.',
  TEMPLATE_NOT_CONFIGURED:
    'The WhatsApp reminder message template is not set up on this server. Ask an administrator to add it.',
  NO_RECIPIENT: 'This client has no saved WhatsApp or phone number. Enter the number to send to.',
  RECIPIENT_INVALID: 'Enter a valid international phone number, e.g. +252 61 234 5678.',
  COMPANY_NAME_MISSING:
    "The company name is missing, and the message names the sender. Add it in the organisation's settings first.",
};

/** The follow-up note a sent reminder leaves on the invoice's collection timeline. */
export function reminderFollowUpNote(kind: string, recipient: string): string {
  const what = kind === 'OVERDUE_REMINDER' ? 'Overdue reminder' : 'Payment reminder';
  return `${what} sent through Rukna on WhatsApp to ${recipient}`;
}
