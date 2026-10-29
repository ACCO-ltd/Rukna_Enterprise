import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { resolveInvoiceDocumentSnapshot } from '../../accounting-core/infrastructure/invoice-document-policy.repository.js';
import { SupplierPaymentDocumentRepository } from '../infrastructure/supplier-payment-document.repository.js';
import { RemittanceDocumentService } from './remittance-document.service.js';

export const REMITTANCE_PDF_MIME_TYPE = 'application/pdf';

/** `PAY-000031-remittance.pdf` — the attachment name the supplier sees. */
export function remittancePdfFilename(paymentNumber: string | null): string {
  return `${paymentNumber ?? 'payment'}-remittance.pdf`;
}

/**
 * Step 4 — the remittance advice of a POSTED supplier payment, on the receipt document's pattern:
 * rendered once on first request, stored through PlatformFileService.storeGenerated, bound by
 * compare-and-set, then IMMUTABLE. A reversed payment's advice is never served.
 */
@Injectable()
export class SupplierPaymentDocumentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SupplierPaymentDocumentRepository,
    private readonly renderer: RemittanceDocumentService,
    private readonly files: PlatformFileService,
  ) {}

  /** A short-lived signed download URL for the remittance advice. */
  async getOrGenerateDocument(identity: RequestIdentity, paymentId: string) {
    const fileId = await this.ensureDocument(identity, paymentId);
    return this.files.getDownloadUrl(identity, fileId);
  }

  private async ensureDocument(identity: RequestIdentity, paymentId: string): Promise<string> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const payment = await this.repo.findForDocument(prisma, orgId, paymentId);
    if (!payment) throw new NotFoundException(`SupplierPayment ${paymentId} not found`);
    if (payment.postingStatus === 'REVERSED') {
      throw new ConflictException({ errorCode: 'PAYMENT_REVERSED', message: 'This payment was reversed, so its remittance advice is no longer issued.' });
    }
    if (payment.postingStatus !== 'POSTED' || !payment.paymentNumber) {
      throw new ConflictException({ errorCode: 'NOT_POSTED', message: 'A remittance advice is issued once the payment is posted.' });
    }
    const why = `remittance advice for ${paymentId}`;
    if (payment.documentFileId) {
      if (payment.documentFile?.lifecycle !== 'IMMUTABLE') {
        await this.files.bind(payment.documentFileId, why);
        await this.files.markImmutable(payment.documentFileId, why);
      }
      return payment.documentFileId;
    }

    const [logo, settings] = await Promise.all([
      this.files.readBytesForRendering(payment.organization.logoFileId),
      resolveInvoiceDocumentSnapshot(prisma, orgId),
    ]);
    const total = new Decimal(payment.totalAmount.toString());
    const applied = payment.allocations.reduce((sum, a) => sum.plus(a.allocatedAmount.toString()), new Decimal(0));
    const org = payment.organization;
    const pdf = await this.renderer.render({
      paymentNumber: payment.paymentNumber,
      paymentDate: payment.paymentDate,
      currencyCode: payment.currencyCode,
      totalAmount: total.toFixed(2),
      bills: payment.allocations.map((a) => ({
        reference: a.bill.billNumber ? `${a.bill.supplierInvoiceNumber} (our ${a.bill.billNumber})` : a.bill.supplierInvoiceNumber,
        amount: new Decimal(a.allocatedAmount.toString()).toFixed(2),
      })),
      unallocatedAmount: total.minus(applied).toFixed(2),
      paymentMethod: payment.paymentMethod,
      bankAccountLabel: payment.bankAccount ? `${payment.bankAccount.bankName} — ${payment.bankAccount.accountName}` : null,
      bankReference: payment.bankReference,
      supplierName: payment.supplier.name,
      supplierAddress: payment.supplier.address,
      org: {
        name: org.name,
        legalAddress: org.legalAddress,
        taxRegistrationNumber: org.taxRegistrationNumber,
        brandColorHex: org.brandColorHex,
        template: org.invoiceTemplate === 'COMPACT' ? 'COMPACT' : 'STANDARD',
        logo,
        tagline: settings?.tagline ?? null,
      },
      footer: settings?.footer ?? null,
    });

    const file = await this.files.storeGenerated(identity, {
      originalName: remittancePdfFilename(payment.paymentNumber),
      mimeType: REMITTANCE_PDF_MIME_TYPE,
      body: pdf,
    });
    const won = await this.repo.bindDocumentFileIdIfUnset(prisma, paymentId, file.id);
    if (!won) {
      await this.files.discardIfUnreferenced(file.id);
      const winner = await this.repo.findDocumentFileId(prisma, orgId, paymentId);
      if (!winner) throw new ConflictException({ errorCode: 'PAYMENT_DOCUMENT_UNAVAILABLE', message: 'The remittance advice could not be bound. Try again.' });
      return winner;
    }
    await this.files.bind(file.id, why);
    await this.files.markImmutable(file.id, why);
    return file.id;
  }
}
