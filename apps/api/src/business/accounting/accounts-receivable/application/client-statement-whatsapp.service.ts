import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OutboundMessageView, RequestIdentity, WhatsAppSendPreview, WhatsAppSendRequest } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommunicationService } from '../../../../platform/messaging/communication.service.js';
import { WhatsAppClient } from '../../../../platform/messaging/whatsapp/whatsapp.client.js';
import { resolveWhatsAppTemplate } from '../../../../platform/messaging/whatsapp/whatsapp-templates.js';
import {
  defaultWhatsAppRecipient,
  formatMessageAmount,
  formatMessageDate,
  normaliseWhatsAppRecipient,
  renderWhatsAppMessage,
  whatsappRecipientOptions,
  whatsappSendBlockedReason,
} from '../../../../platform/messaging/whatsapp/whatsapp-send-preview.js';
import { ClientStatementRepository } from '../infrastructure/client-statement.repository.js';
import { ClientStatementDocumentService } from './client-statement-document.service.js';
import { statementPdfFilename } from './statement-document.service.js';

/** Messages about a statement are kept on the client (a statement is not a stored document). */
export const STATEMENT_MESSAGE_RESOURCE_TYPE = 'client_statement';

/** Values for `rukna_statement` {{1}}…{{4}}: client, balance due, statement date, company. */
export function statementTemplateParams(input: { clientName: string; balanceDue: string; asOf: string; orgName: string }): string[] {
  return [
    input.clientName,
    formatMessageAmount(input.balanceDue, 'USD'),
    formatMessageDate(new Date(`${input.asOf}T00:00:00.000Z`)),
    input.orgName,
  ];
}

/**
 * ST-6 — "Send statement by WhatsApp": the statement PDF for the chosen period goes to the client
 * as the DOCUMENT header of the approved `rukna_statement` template, through CommunicationService
 * (which records the message, de-duplicates by idempotency key and tracks delivery).
 */
@Injectable()
export class ClientStatementWhatsAppService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ClientStatementRepository,
    private readonly documents: ClientStatementDocumentService,
    private readonly communication: CommunicationService,
    private readonly whatsapp: WhatsAppClient,
    private readonly config: ConfigService,
  ) {}

  async preview(identity: RequestIdentity, clientId: string, from?: string, to?: string): Promise<WhatsAppSendPreview> {
    const client = await this.client(identity, clientId);
    const { statement, filename } = await this.documents.render(identity, clientId, from, to);
    const recipients = whatsappRecipientOptions(client.contacts, client.countryCode);
    const defaultRecipient = defaultWhatsAppRecipient(recipients);
    const templateConfigured = resolveWhatsAppTemplate(this.config, 'STATEMENT') !== null;
    const whatsappConfigured = this.whatsapp.isConfigured();
    const blockedReason = whatsappSendBlockedReason({
      posted: true,
      reversed: false,
      hasRecipient: defaultRecipient !== null,
      templateConfigured,
      whatsappConfigured,
    });
    return {
      templateConfigured,
      whatsappConfigured,
      recipients,
      defaultRecipient,
      message: renderWhatsAppMessage('STATEMENT', this.params(statement)),
      filename,
      sendable: blockedReason === null,
      blockedReason,
    };
  }

  async send(
    identity: RequestIdentity,
    clientId: string,
    dto: WhatsAppSendRequest,
    from?: string,
    to?: string,
  ): Promise<OutboundMessageView> {
    const client = await this.client(identity, clientId);
    const template = resolveWhatsAppTemplate(this.config, 'STATEMENT');
    if (!template) {
      throw new BadRequestException({ errorCode: 'TEMPLATE_NOT_CONFIGURED', message: 'The WhatsApp statement template is not set up on this server.' });
    }
    if (!this.whatsapp.isConfigured()) {
      throw new BadRequestException({ errorCode: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp sending is not set up on this server.' });
    }
    const recipient =
      dto.recipient !== undefined && dto.recipient !== null && dto.recipient !== ''
        ? normaliseWhatsAppRecipient(dto.recipient)
        : defaultWhatsAppRecipient(whatsappRecipientOptions(client.contacts, client.countryCode));
    if (!recipient) {
      throw new BadRequestException({
        errorCode: 'NO_RECIPIENT',
        field: 'recipient',
        message: 'This client has no contact with a WhatsApp or phone number. Enter a number to send to.',
        details: { field: 'recipient' },
      });
    }

    const document = await this.documents.render(identity, clientId, from, to);
    return this.communication.sendWhatsAppTemplate(identity, {
      purpose: 'STATEMENT',
      clientId,
      recipient,
      resourceType: STATEMENT_MESSAGE_RESOURCE_TYPE,
      resourceId: clientId,
      templateName: template.name,
      language: template.language,
      bodyParams: this.params(document.statement),
      document: { bytes: document.bytes, mimeType: document.mimeType, filename: statementPdfFilename(document.statement) },
      idempotencyKey: `statement-send:${clientId}:${dto.idempotencyKey.trim()}`,
    });
  }

  private async client(identity: RequestIdentity, clientId: string) {
    const client = await this.repo.findClientContacts(this.tenancy.getClient() as never, identity.activeOrganizationId, clientId);
    if (!client) throw new NotFoundException({ errorCode: 'CLIENT_NOT_FOUND', message: `Client ${clientId} not found` });
    return client;
  }

  private params(statement: Awaited<ReturnType<ClientStatementDocumentService['render']>>['statement']): string[] {
    const owed = statement.openInvoices.reduce((sum, i) => sum + Math.round(Number(i.balance) * 100), 0) / 100;
    return statementTemplateParams({
      clientName: statement.client.name,
      balanceDue: (owed - Number(statement.onAccount)).toFixed(2),
      asOf: statement.asOf,
      orgName: statement.organization?.name ?? '',
    });
  }
}
