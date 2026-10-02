import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type {
  OutboundMessageView,
  RequestIdentity,
  WhatsAppSendBlockedReason,
  WhatsAppSendPreview,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommunicationService } from '../../../../platform/messaging/communication.service.js';
import { WhatsAppClient } from '../../../../platform/messaging/whatsapp/whatsapp.client.js';
import { resolveWhatsAppTemplate } from '../../../../platform/messaging/whatsapp/whatsapp-templates.js';
import {
  INVOICE_TEMPLATE_BODY,
  REACHED_STATUSES,
  WHATSAPP_REFUSAL_MESSAGE,
  buildInvoiceBodyParams,
  defaultRecipient,
  isE164,
  isIssuedForSending,
  recipientOptions,
  renderTemplateBody,
  whatsAppBlockedReason,
} from '../domain/invoice-whatsapp.js';
import {
  InvoiceWhatsAppRepository,
  type InvoiceForWhatsApp,
} from '../infrastructure/invoice-whatsapp.repository.js';
import { ClientInvoiceService } from './client-invoice.service.js';

export const CLIENT_INVOICE_RESOURCE = 'client_invoice';

type Db = Prisma.TransactionClient | ReturnType<TenancyService['getClient']>;

/**
 * ADR-042 — WhatsApp V1 step 2: send an issued invoice to the client on WhatsApp (the frozen PDF as
 * the template's DOCUMENT header) and, once WhatsApp accepts it, record the delivery so the invoice
 * becomes SENT. The message itself — its record, idempotency, provider failures, status ticks —
 * belongs to the platform CommunicationService.
 */
@Injectable()
export class InvoiceWhatsAppService implements OnModuleInit {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsAppClient,
    private readonly communication: CommunicationService,
    private readonly invoices: ClientInvoiceService,
    private readonly repo: InvoiceWhatsAppRepository,
  ) {}

  /** "Mark as sent" on an UNKNOWN invoice message records the delivery in the same transaction. */
  onModuleInit(): void {
    this.communication.onResolvedAsSent(CLIENT_INVOICE_RESOURCE, (tx, identity, message) =>
      this.recordDelivery(tx, identity, message).then(() => undefined),
    );
  }

  async preview(identity: RequestIdentity, invoiceId: string): Promise<WhatsAppSendPreview> {
    const ctx = await this.load(identity, invoiceId);
    const recipients = recipientOptions(
      await this.repo.listContacts(
        this.tenancy.getClient(),
        identity.activeOrganizationId,
        ctx.invoice.clientId,
      ),
    );
    const recipient = defaultRecipient(recipients);
    const blockedReason = whatsAppBlockedReason({ ...ctx.state, recipient });
    return {
      templateConfigured: ctx.state.templateConfigured,
      whatsappConfigured: ctx.state.whatsappConfigured,
      recipients,
      defaultRecipient: recipient,
      message: renderTemplateBody(INVOICE_TEMPLATE_BODY, ctx.bodyParams),
      filename: ctx.filename,
      sendable: blockedReason === null,
      blockedReason,
    };
  }

  /**
   * Sends the invoice. Refusals (not issued, not configured, no / invalid number) are 400/409 with an
   * errorCode; a provider failure is NOT an error — the FAILED / UNKNOWN message comes back (200) for
   * the page to show. A repeat with the same idempotency key returns the same message, never a second
   * send, and records the delivery at most once.
   */
  async send(
    identity: RequestIdentity,
    invoiceId: string,
    input: { recipient?: string | null; idempotencyKey: string },
  ): Promise<OutboundMessageView> {
    const ctx = await this.load(identity, invoiceId);
    const db = this.tenancy.getClient();

    let recipient = input.recipient?.trim() || null;
    if (recipient && !isE164(recipient)) throw refuse('RECIPIENT_INVALID');
    if (!recipient) {
      recipient = defaultRecipient(
        recipientOptions(
          await this.repo.listContacts(db, identity.activeOrganizationId, ctx.invoice.clientId),
        ),
      );
    }
    const blocked = whatsAppBlockedReason({ ...ctx.state, recipient });
    if (blocked) throw refuse(blocked);

    const bytes = await this.invoices.readDocumentBytes(identity, invoiceId);
    const message = await this.communication.sendWhatsAppTemplate(identity, {
      purpose: 'INVOICE',
      clientId: ctx.invoice.clientId,
      recipient: recipient!,
      resourceType: CLIENT_INVOICE_RESOURCE,
      resourceId: invoiceId,
      templateName: ctx.template!.name,
      language: ctx.template!.language,
      bodyParams: ctx.bodyParams,
      document: { bytes, mimeType: 'application/pdf', filename: ctx.filename },
      idempotencyKey: `invoice-send:${invoiceId}:${input.idempotencyKey.trim()}`,
    });

    if (REACHED_STATUSES.has(message.status)) await this.recordDelivery(db, identity, message);
    return message;
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async recordDelivery(
    db: Db,
    identity: RequestIdentity,
    message: OutboundMessageView,
  ): Promise<boolean> {
    return this.repo.recordMessageDelivery(db, {
      organizationId: identity.activeOrganizationId,
      invoiceId: message.resourceId,
      recipient: message.recipient,
      sentAt: message.sentAt ? new Date(message.sentAt) : new Date(),
      sentBy: identity.userId,
      outboundMessageId: message.id,
    });
  }

  private async load(identity: RequestIdentity, invoiceId: string) {
    const db = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const invoice = await this.repo.findInvoice(db, orgId, invoiceId);
    if (!invoice) throw new NotFoundException(`ClientInvoice ${invoiceId} not found`);

    const snapshot = (invoice.billingAddressSnapshot ?? {}) as {
      client?: { name?: string | null } | null;
      clientName?: string;
      org?: { name?: string | null } | null;
    };
    const [clientName, companyName] = await Promise.all([
      snapshot.client?.name ||
        snapshot.clientName ||
        this.repo.findClientName(db, orgId, invoice.clientId),
      snapshot.org?.name || this.repo.findOrganizationName(db, orgId),
    ]);

    const template = resolveWhatsAppTemplate(this.config, 'INVOICE');
    const invoiceNumber = invoice.invoiceNumber ?? '';
    return {
      invoice,
      template,
      filename: `${invoiceNumber || `invoice-${invoice.id}`}.pdf`,
      bodyParams: buildInvoiceBodyParams({
        clientName: clientName || 'Client',
        invoiceNumber,
        totalAmount: invoice.totalAmount,
        currencyCode: invoice.currencyCode,
        dueDate: invoice.dueDate,
        companyName: companyName || '',
      }),
      state: {
        issued: isIssuedForSending(invoice),
        whatsappConfigured: this.whatsapp.isConfigured(),
        templateConfigured: template !== null,
      },
    } satisfies {
      invoice: InvoiceForWhatsApp;
      template: { name: string; language: string } | null;
      filename: string;
      bodyParams: string[];
      state: { issued: boolean; whatsappConfigured: boolean; templateConfigured: boolean };
    };
  }
}

function refuse(code: WhatsAppSendBlockedReason | 'RECIPIENT_INVALID'): Error {
  const body = {
    errorCode: code,
    message: WHATSAPP_REFUSAL_MESSAGE[code],
    ...(code === 'RECIPIENT_INVALID' || code === 'NO_RECIPIENT'
      ? { details: { field: 'recipient' } }
      : {}),
  };
  return code === 'NOT_POSTED' ? new ConflictException(body) : new BadRequestException(body);
}
