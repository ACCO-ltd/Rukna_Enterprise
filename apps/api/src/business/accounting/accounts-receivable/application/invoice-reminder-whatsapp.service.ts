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
  WhatsAppReminderKind,
  WhatsAppReminderPreview,
  WhatsAppSendBlockedReason,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommunicationService } from '../../../../platform/messaging/communication.service.js';
import { WhatsAppClient } from '../../../../platform/messaging/whatsapp/whatsapp.client.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { resolveWhatsAppTemplate } from '../../../../platform/messaging/whatsapp/whatsapp-templates.js';
import { renderWhatsAppMessage } from '../../../../platform/messaging/whatsapp/whatsapp-send-preview.js';
import { defaultRecipient, isE164, recipientOptions } from '../domain/invoice-whatsapp.js';
import {
  REMINDER_REFUSAL_MESSAGE,
  buildReminderBodyParams,
  hasOutstanding,
  isRemindable,
  reminderBlockedReason,
  reminderInvoiceReference,
  reminderDaysPastDue,
  reminderFollowUpNote,
  reminderKind,
} from '../domain/invoice-reminder.js';
import { InvoiceWhatsAppRepository } from '../infrastructure/invoice-whatsapp.repository.js';

/**
 * The OutboundMessage resourceType of a reminder (resourceId = the invoice id). Separate from
 * 'client_invoice' so a reminder never records an invoice delivery (that hook is the invoice send's).
 */
export const CLIENT_INVOICE_REMINDER_RESOURCE = 'client_invoice_reminder';

/**
 * ADR-042 — WhatsApp V1 step 4: a MANUAL payment / overdue reminder for one client invoice, one
 * invoice at a time (no bulk, no schedule). WhatsApp is never the accounting source of truth: the
 * reminder changes no amount or status; once WhatsApp accepts it, the existing collection record —
 * an InvoiceFollowUp (method WHATSAPP) — is written, in the transaction that marks the message SENT.
 */
@Injectable()
export class InvoiceReminderWhatsAppService implements OnModuleInit {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsAppClient,
    private readonly communication: CommunicationService,
    private readonly repo: InvoiceWhatsAppRepository,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  /**
   * The follow-up follows its WhatsApp message: recorded when the message gets through (send
   * accepted, webhook confirmation, or "Mark as sent"), removed when WhatsApp later reports it FAILED.
   */
  onModuleInit(): void {
    this.communication.registerStatusHooks(CLIENT_INVOICE_REMINDER_RESOURCE, {
      onSent: async (tx, ctx, message) => {
        const recorded = await this.repo.recordReminderFollowUp(tx, {
          organizationId: ctx.organizationId,
          invoiceId: message.resourceId,
          note: reminderFollowUpNote(message.purpose, message.recipient),
          occurredAt: message.sentAt ? new Date(message.sentAt) : new Date(),
          recordedBy: ctx.actorUserId,
          outboundMessageId: message.id,
        });
        if (!recorded) return;
        await this.auditOutbox.record(tx, {
          organizationId: ctx.organizationId,
          actorUserId: ctx.actorUserId,
          action: 'whatsapp reminder recorded as follow-up',
          resourceType: 'ClientInvoice',
          resourceId: message.resourceId,
          sourceCommand: 'invoice-reminder-whatsapp.message-sent',
          eventType: 'client-invoice.whatsapp-reminder-recorded',
          idempotencyKey: `client-invoice.whatsapp-reminder-recorded:${message.id}`,
          after: {
            followUpMethod: 'WHATSAPP',
            reminderKind: message.purpose,
            outboundMessageId: message.id,
          },
        });
      },
      onFailed: async (tx, ctx, message) => {
        const voided = await this.repo.voidReminderFollowUp(tx, ctx.organizationId, message.id);
        if (voided === 0) return;
        await this.auditOutbox.record(tx, {
          organizationId: ctx.organizationId,
          actorUserId: ctx.actorUserId,
          action: 'whatsapp reminder follow-up voided: message failed',
          resourceType: 'ClientInvoice',
          resourceId: message.resourceId,
          sourceCommand: 'invoice-reminder-whatsapp.message-failed',
          eventType: 'client-invoice.whatsapp-reminder-voided',
          idempotencyKey: `client-invoice.whatsapp-reminder-voided:${message.id}`,
          before: { followUpMethod: 'WHATSAPP', outboundMessageId: message.id },
          after: { messageStatus: message.status, errorCode: message.errorCode },
        });
      },
    });
  }

  async preview(identity: RequestIdentity, invoiceId: string): Promise<WhatsAppReminderPreview> {
    const ctx = await this.load(identity, invoiceId);
    const recipients = recipientOptions(
      await this.repo.listContacts(
        this.tenancy.getClient(),
        identity.activeOrganizationId,
        ctx.invoice.clientId,
      ),
    );
    const recipient = defaultRecipient(recipients);
    const blockedReason = reminderBlockedReason({ ...ctx.state, recipient });
    return {
      kind: ctx.kind,
      outstandingAmount: ctx.invoice.outstandingAmount,
      currencyCode: ctx.invoice.currencyCode,
      daysPastDue: ctx.daysPastDue,
      templateConfigured: ctx.state.templateConfigured,
      whatsappConfigured: ctx.state.whatsappConfigured,
      recipients,
      defaultRecipient: recipient,
      message: renderWhatsAppMessage(ctx.kind, ctx.bodyParams),
      filename: null,
      sendable: blockedReason === null,
      blockedReason,
    };
  }

  /**
   * Sends the reminder. Refusals are 400/409 with an errorCode; a provider failure is NOT an error —
   * the FAILED / UNKNOWN message comes back (200). A repeat with the same idempotency key returns the
   * same message, never a second send.
   */
  async send(
    identity: RequestIdentity,
    invoiceId: string,
    input: { recipient?: string | null; idempotencyKey: string },
  ): Promise<OutboundMessageView> {
    const idempotencyKey = `invoice-reminder:${invoiceId}:${input.idempotencyKey.trim()}`;
    // A replay returns the original message even if the invoice has changed since (e.g. it was paid):
    // that send already happened. Only a FAILED one goes through the checks again before a retry.
    const existing = await this.communication.findForResourceByKey(
      identity,
      idempotencyKey,
      CLIENT_INVOICE_REMINDER_RESOURCE,
      invoiceId,
    );
    if (existing && existing.status !== 'FAILED') return existing;

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
    const blocked = reminderBlockedReason({ ...ctx.state, recipient });
    if (blocked) throw refuse(blocked);
    if (!ctx.companyName) throw refuse('COMPANY_NAME_MISSING');

    return this.communication.sendWhatsAppTemplate(identity, {
      purpose: ctx.kind,
      clientId: ctx.invoice.clientId,
      recipient: recipient!,
      resourceType: CLIENT_INVOICE_REMINDER_RESOURCE,
      resourceId: invoiceId,
      templateName: ctx.template!.name,
      language: ctx.template!.language,
      bodyParams: ctx.bodyParams,
      idempotencyKey,
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

    const asOf = new Date();
    const reference = reminderInvoiceReference(invoice);
    const kind: WhatsAppReminderKind = reminderKind(invoice.dueDate, asOf);
    const template = resolveWhatsAppTemplate(this.config, kind);
    return {
      invoice,
      kind,
      template,
      daysPastDue: reminderDaysPastDue(invoice.dueDate, asOf),
      companyName: (companyName || '').trim(),
      bodyParams: buildReminderBodyParams({
        clientName: clientName || 'Client',
        invoiceNumber: reference ?? '',
        outstandingAmount: invoice.outstandingAmount,
        currencyCode: invoice.currencyCode,
        dueDate: invoice.dueDate,
        companyName: companyName || '',
      }),
      state: {
        issued: isRemindable(invoice),
        reversed: invoice.postingStatus === 'REVERSED',
        hasReference: reference !== null,
        outstanding: hasOutstanding(invoice.outstandingAmount),
        whatsappConfigured: this.whatsapp.isConfigured(),
        templateConfigured: template !== null,
      },
    };
  }
}

function refuse(
  code: WhatsAppSendBlockedReason | 'RECIPIENT_INVALID' | 'COMPANY_NAME_MISSING',
): Error {
  const body = {
    errorCode: code,
    message: REMINDER_REFUSAL_MESSAGE[code],
    ...(code === 'RECIPIENT_INVALID' || code === 'NO_RECIPIENT'
      ? { details: { field: 'recipient' } }
      : {}),
  };
  return code === 'NOT_POSTED' ||
    code === 'REVERSED' ||
    code === 'NOTHING_OUTSTANDING' ||
    code === 'NO_INVOICE_REFERENCE'
    ? new ConflictException(body)
    : new BadRequestException(body);
}
