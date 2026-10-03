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
import { PaymentReceiptArRepository } from '../infrastructure/payment-receipt-ar.repository.js';
import { PaymentReceiptDocumentService, assertIssuable, receiptPdfFilename } from './payment-receipt-document.service.js';

export const RECEIPT_MESSAGE_RESOURCE_TYPE = 'payment_receipt';

/** Values for `rukna_receipt` {{1}}…{{5}}: client, receipt number, amount, payment date, company. */
export function receiptTemplateParams(receipt: {
  clientName: string;
  receiptNumber: string | null;
  totalAmount: { toFixed(dp: number): string };
  currencyCode: string;
  receiptDate: Date;
  orgName: string;
}): string[] {
  return [
    receipt.clientName,
    receipt.receiptNumber ?? 'DRAFT',
    formatMessageAmount(receipt.totalAmount, receipt.currencyCode),
    formatMessageDate(receipt.receiptDate),
    receipt.orgName,
  ];
}

/**
 * "Send receipt by WhatsApp" (WhatsApp V1 step 3, ADR-042 phase 2): the receipt PDF goes to the
 * client as the DOCUMENT header of the approved `rukna_receipt` template, through
 * CommunicationService (which records the OutboundMessage, de-duplicates by idempotency key and
 * tracks delivery). Only a POSTED receipt is sent.
 */
@Injectable()
export class ReceiptWhatsAppService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: PaymentReceiptArRepository,
    private readonly documents: PaymentReceiptDocumentService,
    private readonly communication: CommunicationService,
    private readonly whatsapp: WhatsAppClient,
    private readonly config: ConfigService,
  ) {}

  /** What a send would do right now — recipients, the exact message, and whether it can go. */
  async preview(identity: RequestIdentity, receiptId: string): Promise<WhatsAppSendPreview> {
    const receipt = await this.load(identity, receiptId);
    const recipients = whatsappRecipientOptions(receipt.client.contacts, receipt.client.countryCode);
    const defaultRecipient = defaultWhatsAppRecipient(recipients);
    const templateConfigured = resolveWhatsAppTemplate(this.config, 'RECEIPT') !== null;
    const whatsappConfigured = this.whatsapp.isConfigured();
    const blockedReason = whatsappSendBlockedReason({
      posted: isIssuable(receipt),
      reversed: receipt.postingStatus === 'REVERSED',
      hasRecipient: defaultRecipient !== null,
      templateConfigured,
      whatsappConfigured,
    });
    return {
      templateConfigured,
      whatsappConfigured,
      recipients,
      defaultRecipient,
      message: renderWhatsAppMessage('RECEIPT', this.params(receipt)),
      filename: receiptPdfFilename(receipt.receiptNumber),
      sendable: blockedReason === null,
      blockedReason,
    };
  }

  /**
   * Send the receipt. `recipient` defaults to the primary contact's number; any valid E.164 number
   * is accepted (staff may type one). The caller's idempotency key is namespaced to this receipt, so
   * a repeat returns the same message and a retry after FAILED re-sends on the same record.
   */
  async send(identity: RequestIdentity, receiptId: string, dto: WhatsAppSendRequest): Promise<OutboundMessageView> {
    const receipt = await this.load(identity, receiptId);
    assertIssuable(receipt);
    const template = resolveWhatsAppTemplate(this.config, 'RECEIPT');
    if (!template) {
      throw new BadRequestException({
        errorCode: 'TEMPLATE_NOT_CONFIGURED',
        message: 'The WhatsApp receipt template is not set up on this server.',
      });
    }
    if (!this.whatsapp.isConfigured()) {
      throw new BadRequestException({ errorCode: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp sending is not set up on this server.' });
    }

    const recipient =
      dto.recipient !== undefined && dto.recipient !== null && dto.recipient !== ''
        ? normaliseWhatsAppRecipient(dto.recipient)
        : defaultWhatsAppRecipient(whatsappRecipientOptions(receipt.client.contacts, receipt.client.countryCode));
    if (!recipient) {
      throw new BadRequestException({
        errorCode: 'NO_RECIPIENT',
        field: 'recipient',
        message: 'This client has no contact with a WhatsApp or phone number. Enter a number to send to.',
        details: { field: 'recipient' },
      });
    }

    const document = await this.documents.getOrGenerateReceiptPdf(identity, receiptId);
    return this.communication.sendWhatsAppTemplate(identity, {
      purpose: 'RECEIPT',
      clientId: receipt.clientId,
      recipient,
      resourceType: RECEIPT_MESSAGE_RESOURCE_TYPE,
      resourceId: receiptId,
      templateName: template.name,
      language: template.language,
      bodyParams: this.params(receipt),
      document: { bytes: document.bytes, mimeType: document.mimeType, filename: document.filename },
      idempotencyKey: `receipt-send:${receiptId}:${dto.idempotencyKey.trim()}`,
    });
  }

  private async load(identity: RequestIdentity, receiptId: string) {
    const receipt = await this.repo.findForDocument(this.tenancy.getClient(), identity.activeOrganizationId, receiptId);
    if (!receipt) throw new NotFoundException(`PaymentReceipt ${receiptId} not found`);
    return receipt;
  }

  private params(receipt: Awaited<ReturnType<ReceiptWhatsAppService['load']>>): string[] {
    return receiptTemplateParams({
      clientName: receipt.client.name,
      receiptNumber: receipt.receiptNumber,
      totalAmount: receipt.totalAmount,
      currencyCode: receipt.currencyCode,
      receiptDate: receipt.receiptDate,
      orgName: receipt.organization.name,
    });
  }
}

function isIssuable(receipt: { postingStatus: string; receiptNumber: string | null }): boolean {
  return receipt.postingStatus === 'POSTED' && !!receipt.receiptNumber;
}
