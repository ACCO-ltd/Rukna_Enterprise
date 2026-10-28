import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Step 4 — what the remittance advice prints, and the compare-and-set that binds its PDF. */
@Injectable()
export class SupplierPaymentDocumentRepository {
  findForDocument(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.supplierPayment.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        paymentNumber: true,
        paymentDate: true,
        currencyCode: true,
        totalAmount: true,
        paymentMethod: true,
        bankReference: true,
        postingStatus: true,
        documentFileId: true,
        documentFile: { select: { lifecycle: true } },
        bankAccount: { select: { bankName: true, accountName: true } },
        supplier: { select: { name: true, address: true } },
        allocations: {
          where: { postingStatus: 'POSTED' },
          select: { allocatedAmount: true, bill: { select: { billNumber: true, supplierInvoiceNumber: true } } },
        },
        organization: {
          select: { name: true, logoFileId: true, legalAddress: true, taxRegistrationNumber: true, brandColorHex: true, invoiceTemplate: true },
        },
      },
    });
  }

  async bindDocumentFileIdIfUnset(prisma: TenantPrisma, id: string, documentFileId: string): Promise<boolean> {
    const { count } = await prisma.supplierPayment.updateMany({ where: { id, documentFileId: null }, data: { documentFileId } });
    return count === 1;
  }

  findDocumentFileId(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.supplierPayment
      .findFirst({ where: { id, organizationId }, select: { documentFileId: true } })
      .then((r) => r?.documentFileId ?? null);
  }
}
