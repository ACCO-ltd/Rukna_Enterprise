import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OutboundMessageView, RequestIdentity, SupplierStatement, WhatsAppSendPreview, WhatsAppSendRequest } from '@erp/types';

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
import { SupplierStatementRepository } from '../infrastructure/supplier-statement.repository.js';
import { SupplierStatementDocumentService } from './supplier-statement-document.service.js';

/** Messages about a supplier statement are kept on the supplier (a statement is not a stored document). */
export const SUPPLIER_STATEMENT_MESSAGE_RESOURCE_TYPE = 'supplier_statement';

/** Values for `rukna_supplier_statement` {{1}}…{{4}}: supplier, what we owe, statement date, company. */
export function supplierStatementTemplateParams(input: { supplierName: string; owed: string; asOf: string; orgName: string }): string[] {
  return [
    input.supplierName,
    formatMessageAmount(input.owed, 'USD'),
    formatMessageDate(new Date(`${input.asOf}T00:00:00.000Z`)),
    input.orgName,
  ];
}

/**
 * SS-3 — "Send to supplier on WhatsApp": our statement of their account for the period goes to
 * the supplier as the DOCUMENT header of the approved `rukna_supplier_statement` template, so they
 * can check it against their own. Through CommunicationService (recorded, de-duplicated by
 * idempotency key, delivery tracked), like the client statement (ST-6).
 */
@Injectable()
export class SupplierStatementWhatsAppService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SupplierStatementRepository,
    private readonly documents: SupplierStatementDocumentService,
    private readonly communication: CommunicationService,
    private readonly whatsapp: WhatsAppClient,
    private readonly config: ConfigService,
  ) {}

  async preview(identity: RequestIdentity, supplierId: string, from?: string, to?: string): Promise<WhatsAppSendPreview> {
    const supplier = await this.supplier(identity, supplierId);
    const { statement, filename } = await this.documents.render(identity, supplierId, from, to);
    const recipients = whatsappRecipientOptions(this.contacts(supplier));
    const defaultRecipient = defaultWhatsAppRecipient(recipients);
    const templateConfigured = resolveWhatsAppTemplate(this.config, 'SUPPLIER_STATEMENT') !== null;
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
      message: renderWhatsAppMessage('SUPPLIER_STATEMENT', this.params(statement)),
      filename,
      sendable: blockedReason === null,
      blockedReason,
    };
  }

  async send(
    identity: RequestIdentity,
    supplierId: string,
    dto: WhatsAppSendRequest,
    from?: string,
    to?: string,
  ): Promise<OutboundMessageView> {
    const supplier = await this.supplier(identity, supplierId);
    const template = resolveWhatsAppTemplate(this.config, 'SUPPLIER_STATEMENT');
    if (!template) {
      throw new BadRequestException({ errorCode: 'TEMPLATE_NOT_CONFIGURED', message: 'The WhatsApp supplier statement template is not set up on this server.' });
    }
    if (!this.whatsapp.isConfigured()) {
      throw new BadRequestException({ errorCode: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp sending is not set up on this server.' });
    }
    const recipient =
      dto.recipient !== undefined && dto.recipient !== null && dto.recipient !== ''
        ? normaliseWhatsAppRecipient(dto.recipient)
        : defaultWhatsAppRecipient(whatsappRecipientOptions(this.contacts(supplier)));
    if (!recipient) {
      throw new BadRequestException({
        errorCode: 'NO_RECIPIENT',
        field: 'recipient',
        message: 'This supplier has no contact with a phone number. Enter a number to send to.',
        details: { field: 'recipient' },
      });
    }

    const document = await this.documents.render(identity, supplierId, from, to);
    return this.communication.sendWhatsAppTemplate(identity, {
      purpose: 'SUPPLIER_STATEMENT',
      recipient,
      resourceType: SUPPLIER_STATEMENT_MESSAGE_RESOURCE_TYPE,
      resourceId: supplierId,
      templateName: template.name,
      language: template.language,
      bodyParams: this.params(document.statement),
      document: { bytes: document.bytes, mimeType: document.mimeType, filename: document.filename },
      idempotencyKey: `supplier-statement-send:${supplierId}:${dto.idempotencyKey.trim()}`,
    });
  }

  private async supplier(identity: RequestIdentity, supplierId: string) {
    const supplier = await this.repo.findSupplierContacts(this.tenancy.getClient() as never, identity.activeOrganizationId, supplierId);
    if (!supplier) throw new NotFoundException({ errorCode: 'SUPPLIER_NOT_FOUND', message: `Supplier ${supplierId} not found` });
    return supplier;
  }

  /** Supplier contacts keep one phone; it is offered as the WhatsApp number. */
  private contacts(supplier: NonNullable<Awaited<ReturnType<SupplierStatementWhatsAppService['supplier']>>>) {
    return supplier.contacts.map((c) => ({ ...c, whatsappPhone: null }));
  }

  private params(statement: SupplierStatement): string[] {
    return supplierStatementTemplateParams({
      supplierName: statement.supplier.name,
      owed: statement.closingBalance,
      asOf: statement.to,
      orgName: statement.organization?.name ?? '',
    });
  }
}
