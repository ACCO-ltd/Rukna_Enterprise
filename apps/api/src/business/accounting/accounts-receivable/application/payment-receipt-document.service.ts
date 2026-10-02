import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { PaymentReceiptArRepository } from '../infrastructure/payment-receipt-ar.repository.js';
import { ReceiptDocumentService, type ReceiptDocumentInput } from './receipt-document.service.js';

type ReceiptForDocument = NonNullable<Awaited<ReturnType<PaymentReceiptArRepository['findForDocument']>>>;

export const RECEIPT_PDF_MIME_TYPE = 'application/pdf';

/** `RCP-000017.pdf` — the attachment name the client sees. */
export function receiptPdfFilename(receiptNumber: string | null): string {
  return `${receiptNumber ?? 'receipt'}.pdf`;
}

/**
 * The branded receipt PDF of a POSTED receipt (WhatsApp V1 step 3), on the invoice document's
 * pattern (ClientInvoiceService.getOrGenerateDocument): rendered once, on first request, stored
 * through PlatformFileService.storeGenerated, bound to the receipt by compare-and-set, and then
 * IMMUTABLE — a later view or send gets the same bytes, even after the org changes its branding.
 *
 * Only a POSTED receipt with a receipt number has a document: a draft is not a receipt yet, and a
 * reversed one must not be issued again (an already-generated document stays downloadable — it is
 * the record of what was issued).
 */
@Injectable()
export class PaymentReceiptDocumentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: PaymentReceiptArRepository,
    private readonly renderer: ReceiptDocumentService,
    private readonly files: PlatformFileService,
  ) {}

  /** A short-lived signed download URL for the receipt PDF (file access re-checked by owner). */
  async getOrGenerateReceiptDocument(identity: RequestIdentity, receiptId: string) {
    const { fileId } = await this.ensureDocument(identity, receiptId);
    return this.files.getDownloadUrl(identity, fileId);
  }

  /**
   * The receipt PDF's bytes for attaching to a message — not a download, so not gated by the file
   * authorization (the caller already holds the receipt permission). Generates it on first use.
   */
  async getOrGenerateReceiptPdf(
    identity: RequestIdentity,
    receiptId: string,
  ): Promise<{ bytes: Buffer; mimeType: string; filename: string }> {
    const { fileId, receiptNumber } = await this.ensureDocument(identity, receiptId);
    const file = await this.files.readBytesForRendering(fileId);
    if (!file) {
      throw new ConflictException({ errorCode: 'RECEIPT_DOCUMENT_UNAVAILABLE', message: 'The receipt document could not be read. Try again.' });
    }
    return { bytes: file.buffer, mimeType: RECEIPT_PDF_MIME_TYPE, filename: receiptPdfFilename(receiptNumber) };
  }

  /** The bound document's file id, rendering and binding it first when there is none. */
  private async ensureDocument(
    identity: RequestIdentity,
    receiptId: string,
  ): Promise<{ fileId: string; receiptNumber: string | null }> {
    const prisma = this.tenancy.getClient();
    const receipt = await this.repo.findForDocument(prisma, identity.activeOrganizationId, receiptId);
    if (!receipt) throw new NotFoundException(`PaymentReceipt ${receiptId} not found`);
    if (receipt.documentFileId) return { fileId: receipt.documentFileId, receiptNumber: receipt.receiptNumber };
    if (receipt.postingStatus !== 'POSTED' || !receipt.receiptNumber) {
      throw new ConflictException({
        errorCode: 'NOT_POSTED',
        message: 'A receipt document is issued once the receipt is posted.',
      });
    }

    const logo = await this.files.readBytesForRendering(receipt.organization.logoFileId);
    const pdf = await this.renderer.render(toDocumentInput(receipt, receipt.receiptNumber, logo));

    const file = await this.files.storeGenerated(identity, {
      originalName: receiptPdfFilename(receipt.receiptNumber),
      mimeType: RECEIPT_PDF_MIME_TYPE,
      body: pdf,
    });

    // Compare-and-set before freezing: a concurrent first request that bound its own document wins,
    // and this call's still-TEMPORARY file is discarded rather than left as an orphan.
    const won = await this.repo.bindDocumentFileIdIfUnset(prisma, receiptId, file.id);
    if (!won) {
      await this.files.discardIfUnreferenced(file.id);
      const winner = await this.repo.findDocumentFileId(prisma, identity.activeOrganizationId, receiptId);
      if (!winner) {
        throw new ConflictException({ errorCode: 'RECEIPT_DOCUMENT_UNAVAILABLE', message: 'The receipt document could not be bound. Try again.' });
      }
      return { fileId: winner, receiptNumber: receipt.receiptNumber };
    }

    await this.files.bind(file.id, `receipt document for ${receiptId}`);
    await this.files.markImmutable(file.id, `receipt document for ${receiptId}`);
    return { fileId: file.id, receiptNumber: receipt.receiptNumber };
  }
}

function toDocumentInput(
  receipt: ReceiptForDocument,
  receiptNumber: string,
  logo: { buffer: Buffer; mimeType: string } | null,
): ReceiptDocumentInput {
  const total = receipt.totalAmount;
  const applied = receipt.initialAllocations.reduce((sum, a) => sum.plus(a.allocatedAmount), new Decimal(0));
  const org = receipt.organization;
  return {
    receiptNumber,
    receiptDate: receipt.receiptDate,
    currencyCode: receipt.currencyCode,
    totalAmount: total.toFixed(2),
    allocations: receipt.initialAllocations.map((a) => ({
      invoiceNumber: a.invoice.invoiceNumber ?? `(unnumbered, ${a.clientInvoiceId.slice(-6)})`,
      amount: a.allocatedAmount.toFixed(2),
    })),
    unallocatedAmount: total.minus(applied).toFixed(2),
    paymentMethod: receipt.paymentMethod,
    bankAccountLabel: receipt.bankAccount ? `${receipt.bankAccount.bankName} — ${receipt.bankAccount.accountName}` : null,
    reference: receipt.reference,
    bankReference: receipt.bankReference,
    clientName: receipt.client.name,
    clientAddress: clientAddress(receipt.client.address, receipt.client.city),
    org: {
      name: org.name,
      legalAddress: org.legalAddress,
      taxRegistrationNumber: org.taxRegistrationNumber,
      brandColorHex: org.brandColorHex,
      footerNote: org.invoiceFooterNote,
      template: org.invoiceTemplate === 'COMPACT' ? 'COMPACT' : 'STANDARD',
      logo,
    },
  };
}

/** The client's address, with the city appended when the address does not already name it. */
function clientAddress(address: string | null, city: string | null): string | null {
  const street = address?.trim() || null;
  const town = city?.trim() || null;
  if (!street) return town;
  if (!town || street.toLowerCase().includes(town.toLowerCase())) return street;
  return `${street}, ${town}`;
}
