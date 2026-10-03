import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OutboundMessageView,
  RequestIdentity,
  WhatsAppSendBlockedReason,
  WhatsAppSendPreview,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommunicationService } from '../../../../platform/messaging/communication.service.js';
import { WhatsAppClient } from '../../../../platform/messaging/whatsapp/whatsapp.client.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { resolveWhatsAppTemplate } from '../../../../platform/messaging/whatsapp/whatsapp-templates.js';
import {
  INVOICE_TEMPLATE_BODY,
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
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  /**
   * The invoice's delivery follows its WhatsApp message, inside the transaction that changes the
   * message's status: recorded when the message gets through (send accepted, webhook confirmation,
   * or "Mark as sent" — then sentAt is the resolve time), removed again when WhatsApp later reports
   * it FAILED, so the invoice drops back to Issued unless another delivery exists.
   */
  onModuleInit(): void {
    this.communication.registerStatusHooks(CLIENT_INVOICE_RESOURCE, {
      onSent: async (tx, ctx, message) => {
        await this.repo.recordMessageDelivery(tx, {
          organizationId: ctx.organizationId,
          invoiceId: message.resourceId,
          recipient: message.recipient,
          sentAt: message.sentAt ? new Date(message.sentAt) : new Date(),
          sentBy: ctx.actorUserId,
          outboundMessageId: message.id,
        });
      },
      onFailed: async (tx, ctx, message) => {
        const voided = await this.repo.voidMessageDelivery(tx, ctx.organizationId, message.id);
        if (voided === 0) return;
        await this.auditOutbox.record(tx, {
          organizationId: ctx.organizationId,
          actorUserId: ctx.actorUserId,
          action: 'whatsapp delivery voided: message failed',
          resourceType: 'ClientInvoice',
          resourceId: message.resourceId,
          sourceCommand: 'invoice-whatsapp.message-failed',
          eventType: 'client-invoice.whatsapp-delivery-voided',
          idempotencyKey: `client-invoice.whatsapp-delivery-voided:${message.id}`,
          before: { deliveryMethod: 'WHATSAPP', outboundMessageId: message.id },
          after: { messageStatus: message.status, errorCode: message.errorCode },
        });
      },
    });
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
   * send. The delivery is recorded by the onSent hook, in the transaction that marks the message
   * SENT — at most once per message.
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
    if (!ctx.companyName) throw refuse('COMPANY_NAME_MISSING');

    const bytes = await this.invoices.readDocumentBytes(identity, invoiceId);
    return this.communication.sendWhatsAppTemplate(identity, {
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
  }

  // ─── internals ──────────────────────────────────────────────────────────────

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
      companyName: (companyName || '').trim(),
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
        reversed: invoice.postingStatus === 'REVERSED',
        whatsappConfigured: this.whatsapp.isConfigured(),
        templateConfigured: template !== null,
      },
    } satisfies {
      invoice: InvoiceForWhatsApp;
      template: { name: string; language: string } | null;
      companyName: string;
      filename: string;
      bodyParams: string[];
      state: {
        issued: boolean;
        reversed: boolean;
        whatsappConfigured: boolean;
        templateConfigured: boolean;
      };
    };
  }
}

function refuse(
  code: WhatsAppSendBlockedReason | 'RECIPIENT_INVALID' | 'COMPANY_NAME_MISSING',
): Error {
  const body = {
    errorCode: code,
    message: WHATSAPP_REFUSAL_MESSAGE[code],
    ...(code === 'RECIPIENT_INVALID' || code === 'NO_RECIPIENT'
      ? { details: { field: 'recipient' } }
      : {}),
  };
  return code === 'NOT_POSTED' || code === 'REVERSED'
    ? new ConflictException(body)
    : new BadRequestException(body);
}
