import { BadRequestException } from '@nestjs/common';
import type { MessagePurpose } from '@prisma/client';
import { isSupportedCountry, parsePhoneNumberWithError, type CountryCode } from 'libphonenumber-js';
import type { WhatsAppRecipientOption, WhatsAppSendBlockedReason } from '@erp/types';

/**
 * ADR-042 phase 2 — the pieces every "send <document> by WhatsApp" feature shares (receipt today,
 * invoice next): who it can go to, what the client will read, and why it cannot be sent. Pure
 * functions — no Prisma, no Nest beyond the 400 `normaliseWhatsAppRecipient` throws.
 */

/**
 * The approved template bodies, verbatim from docs/integrations/whatsapp-templates.md — used only
 * to show staff the exact message before sending. Meta renders the real message from its own copy
 * of the template; if the two ever differ, the doc (what was submitted to Meta) is the truth.
 */
export const WHATSAPP_TEMPLATE_BODIES: Record<MessagePurpose, string> = {
  INVOICE:
    'Hello {{1}}, please find attached invoice {{2}} from {{5}} for {{3}}, due on {{4}}. If you have any questions about this invoice, reply to this message. Thank you.',
  RECEIPT:
    'Hello {{1}}, thank you for your payment of {{3}} received on {{4}}. Your receipt {{2}} from {{5}} is attached.',
  PAYMENT_REMINDER:
    'Hello {{1}}, this is a reminder from {{5}} that invoice {{2}} for {{3}} is due on {{4}}. If you have already paid, please ignore this message. Thank you.',
  OVERDUE_REMINDER:
    'Hello {{1}}, invoice {{2}} from {{5}} for {{3}} was due on {{4}} and is now overdue. Please arrange payment, or reply to this message if there is a problem with the invoice.',
};

/** The message text with {{1}}…{{n}} filled from `params` (positional, 1-based). */
export function renderWhatsAppMessage(purpose: MessagePurpose, params: string[]): string {
  return WHATSAPP_TEMPLATE_BODIES[purpose].replace(/\{\{(\d+)\}\}/g, (match, n: string) => params[Number(n) - 1] ?? match);
}

/**
 * An amount as the templates expect it: `USD 5,000.00`. Works on the decimal STRING (Prisma
 * Decimal#toString / toFixed) so a large amount is never rounded through a float.
 */
export function formatMessageAmount(amount: string | { toFixed(dp: number): string }, currencyCode: string): string {
  const fixed = typeof amount === 'string' ? toFixed2(amount) : amount.toFixed(2);
  const negative = fixed.startsWith('-');
  const [whole, cents] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currencyCode} ${negative ? '-' : ''}${grouped}.${cents ?? '00'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date as the templates expect it: `02 Oct 2026`. Read in UTC: business dates are stored as
 * `@db.Date` (UTC midnight), so a local-time read could show the previous day.
 */
export function formatMessageDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export interface ContactForRecipient {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  isPrimary: boolean;
}

/**
 * Who a client document can go to: one option per contact with a usable number — the WhatsApp
 * number when on file, otherwise the phone. Numbers are normalised to E.164; an older contact's
 * phone typed without a country code is read against the client's country. A contact with no
 * number that parses is left out. Primary contact first, then WhatsApp numbers, then by name.
 */
export function whatsappRecipientOptions(contacts: ContactForRecipient[], clientCountryCode?: string | null): WhatsAppRecipientOption[] {
  const options: WhatsAppRecipientOption[] = [];
  for (const contact of contacts) {
    const whatsapp = toE164(contact.whatsappPhone, clientCountryCode);
    const phone = whatsapp ? null : toE164(contact.phone, clientCountryCode);
    const number = whatsapp ?? phone;
    if (!number) continue;
    options.push({
      contactId: contact.id,
      name: contact.name,
      role: contact.role,
      number,
      isPrimary: contact.isPrimary,
      source: whatsapp ? 'whatsapp' : 'phone',
    });
  }
  return options.sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      Number(b.source === 'whatsapp') - Number(a.source === 'whatsapp') ||
      a.name.localeCompare(b.name),
  );
}

/** The number a send goes to when it names none: the primary contact's, else the first option's. */
export function defaultWhatsAppRecipient(options: WhatsAppRecipientOption[]): string | null {
  return (options.find((o) => o.isPrimary) ?? options[0])?.number ?? null;
}

/**
 * Why the document cannot be sent with its defaults, most actionable first: the record itself, then
 * who to send to, then the server's WhatsApp set-up. Null = sendable.
 */
export function whatsappSendBlockedReason(state: {
  posted: boolean;
  /** Posted, then reversed. Optional so existing callers keep compiling; checked before `posted`. */
  reversed?: boolean;
  hasRecipient: boolean;
  templateConfigured: boolean;
  whatsappConfigured: boolean;
}): WhatsAppSendBlockedReason | null {
  if (state.reversed) return 'REVERSED';
  if (!state.posted) return 'NOT_POSTED';
  if (!state.hasRecipient) return 'NO_RECIPIENT';
  if (!state.templateConfigured) return 'TEMPLATE_NOT_CONFIGURED';
  if (!state.whatsappConfigured) return 'WHATSAPP_NOT_CONFIGURED';
  return null;
}

/**
 * A send request's recipient → canonical E.164. It must already be international (`+…`) and a
 * valid number by libphonenumber-js; anything else is a 400 `RECIPIENT_INVALID` naming the field.
 */
export function normaliseWhatsAppRecipient(value: unknown): string {
  const fail = () =>
    new BadRequestException({
      errorCode: 'RECIPIENT_INVALID',
      field: 'recipient',
      message: 'Enter the number in international form, e.g. +252612345678',
      details: { field: 'recipient' },
    });
  if (typeof value !== 'string') throw fail();
  const text = value.trim();
  if (!text.startsWith('+') || text.length > 32) throw fail();
  const number = toE164(text);
  if (!number) throw fail();
  return number;
}

/** E.164 for a stored or typed number, or null when it does not parse as a valid number. */
function toE164(value: string | null | undefined, countryCode?: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  const upper = countryCode?.trim().toUpperCase();
  const country: CountryCode | undefined = upper && isSupportedCountry(upper) ? upper : undefined;
  try {
    const parsed = parsePhoneNumberWithError(text, country);
    return parsed.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}

function toFixed2(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return Number(value).toFixed(2);
  const [, sign, whole, frac = ''] = match;
  // Amounts are stored at 2dp (Decimal(18,2)), so the float fallback is only for odd input.
  if (frac.length <= 2) return `${sign}${whole}.${frac.padEnd(2, '0')}`;
  return Number(value).toFixed(2);
}
