import { isValidPhoneNumber } from 'libphonenumber-js';
import type { WhatsAppSendBlockedReason, WhatsAppRecipientOption } from '@erp/types';

/**
 * ADR-042 — WhatsApp V1 step 2: sending an issued invoice through the Meta-approved `rukna_invoice`
 * template (docs/integrations/whatsapp-templates.md). Pure rules: no Prisma, no Nest.
 *
 * The template's variables are filled BY POSITION, so the order below is part of the contract with
 * the template approved in Meta — never reorder:
 *   {{1}} client name · {{2}} invoice number · {{3}} amount · {{4}} due date · {{5}} company name
 */
export const INVOICE_TEMPLATE_BODY =
  'Hello {{1}}, please find attached invoice {{2}} from {{5}} for {{3}}, due on {{4}}. If you have any questions about this invoice, reply to this message. Thank you.';

/** {{4}} for an invoice with no due date — reads "… due on receipt." in the template sentence. */
export const NO_DUE_DATE_TEXT = 'receipt';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** E.164 with '+', valid for its country (libphonenumber-js). */
export function isE164(value: string | null | undefined): value is string {
  const text = value?.trim() ?? '';
  return /^\+[1-9]\d{6,14}$/.test(text) && isValidPhoneNumber(text);
}

/** `USD 12,500.00` — from a decimal string, without floating point. */
export function formatTemplateMoney(amount: string, currencyCode: string): string {
  const text = amount.trim();
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace(/^[-+]/, '').split('.');
  const cents = `${fraction}00`.slice(0, 2);
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currencyCode} ${negative ? '-' : ''}${grouped}.${cents}`;
}

/** `15 Oct 2026` (a calendar date, read in UTC as it is stored), or the no-due-date wording. */
export function formatTemplateDate(date: Date | null): string {
  if (!date) return NO_DUE_DATE_TEXT;
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export interface InvoiceTemplateFacts {
  clientName: string;
  invoiceNumber: string;
  /** Decimal string — the invoice total. */
  totalAmount: string;
  currencyCode: string;
  dueDate: Date | null;
  companyName: string;
}

/** The template body values {{1}}…{{5}}, in order. */
export function buildInvoiceBodyParams(facts: InvoiceTemplateFacts): string[] {
  return [
    facts.clientName.trim(),
    facts.invoiceNumber,
    formatTemplateMoney(facts.totalAmount, facts.currencyCode),
    formatTemplateDate(facts.dueDate),
    facts.companyName.trim(),
  ];
}

/** The body as the client reads it — `{{n}}` replaced by the n-th value. */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => params[Number(n) - 1] ?? match);
}

export interface ContactNumbers {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  isPrimary: boolean;
}

/**
 * One option per contact with a usable number: its WhatsApp number, else its phone (older rows
 * may hold numbers typed before E.164 was enforced — those are skipped). Primary first.
 */
export function recipientOptions(contacts: ContactNumbers[]): WhatsAppRecipientOption[] {
  const options: WhatsAppRecipientOption[] = [];
  for (const c of contacts) {
    const source = isE164(c.whatsappPhone) ? 'whatsapp' : isE164(c.phone) ? 'phone' : null;
    if (!source) continue;
    const number = (source === 'whatsapp' ? c.whatsappPhone : c.phone)!.trim();
    options.push({
      contactId: c.id,
      name: c.name,
      role: c.role,
      number,
      isPrimary: c.isPrimary,
      source,
    });
  }
  return options.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

/** The primary contact's number, else the first saved one, else null. */
export function defaultRecipient(options: WhatsAppRecipientOption[]): string | null {
  return (options.find((o) => o.isPrimary) ?? options[0])?.number ?? null;
}

/** "Issued" = numbered and posted to the ledger, and not cancelled. */
export function isIssuedForSending(invoice: {
  invoiceNumber: string | null;
  postingStatus: string;
  documentStatus: string;
}): boolean {
  return (
    !!invoice.invoiceNumber &&
    invoice.postingStatus === 'POSTED' &&
    invoice.documentStatus !== 'CANCELLED'
  );
}

/**
 * The first reason a send cannot go ahead (null when it can): the record, then who to send to, then
 * the server's WhatsApp set-up — the same order as the receipt send (WhatsApp V1 step 3).
 */
export function whatsAppBlockedReason(state: {
  issued: boolean;
  whatsappConfigured: boolean;
  templateConfigured: boolean;
  recipient: string | null;
}): WhatsAppSendBlockedReason | null {
  if (!state.issued) return 'NOT_POSTED';
  if (!state.recipient) return 'NO_RECIPIENT';
  if (!state.templateConfigured) return 'TEMPLATE_NOT_CONFIGURED';
  if (!state.whatsappConfigured) return 'WHATSAPP_NOT_CONFIGURED';
  return null;
}

/** Plain words for each refusal (the API's error message). */
export const WHATSAPP_REFUSAL_MESSAGE: Record<
  WhatsAppSendBlockedReason | 'RECIPIENT_INVALID',
  string
> = {
  NOT_POSTED: 'Only an issued invoice can be sent. Issue the invoice first.',
  WHATSAPP_NOT_CONFIGURED:
    'WhatsApp sending is not set up on this server. Ask an administrator to connect WhatsApp.',
  TEMPLATE_NOT_CONFIGURED:
    'The WhatsApp invoice message template is not set up on this server. Ask an administrator to add it.',
  NO_RECIPIENT: 'This client has no saved WhatsApp or phone number. Enter the number to send to.',
  RECIPIENT_INVALID: 'Enter a valid international phone number, e.g. +252 61 234 5678.',
};

/** Statuses at which WhatsApp has accepted the message — the invoice counts as delivered. */
export const REACHED_STATUSES = new Set(['SENT', 'DELIVERED', 'READ']);
