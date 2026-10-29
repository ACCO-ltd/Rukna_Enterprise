import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import type { FinanceAttachmentKind } from '../../../../platform/files/domain/finance-attachment-policy.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const FILE_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  lifecycle: true,
  uploadedBy: true,
  createdAt: true,
} as const;

const ROW_SELECT = {
  id: true,
  isPostSubmission: true,
  createdBy: true,
  createdAt: true,
  platformFile: { select: FILE_SELECT },
} as const;

const OWNED_SELECT = { id: true, platformFileId: true, platformFile: { select: { lifecycle: true } } } as const;

export interface CreateFinanceAttachmentData {
  platformFileId: string;
  createdBy: string;
  isPostSubmission: boolean;
}

/**
 * The five finance attachment tables, behind one interface. One explicit branch per table, as in
 * RecordAttachmentRepository: Prisma delegates share no supertype, and `prisma[model]` would
 * type-check as `any`.
 */
@Injectable()
export class FinanceAttachmentRepository {
  /** The document's posting state, scoped to the caller's organization. Null when it is not theirs. */
  async findParentStatus(
    prisma: TenantPrisma,
    organizationId: string,
    kind: FinanceAttachmentKind,
    ownerId: string,
  ): Promise<string | null> {
    const where = { id: ownerId, organizationId };
    switch (kind) {
      case 'INVOICE':
        return (await prisma.clientInvoice.findFirst({ where, select: { postingStatus: true } }))?.postingStatus ?? null;
      case 'RECEIPT':
        return (await prisma.paymentReceipt.findFirst({ where, select: { postingStatus: true } }))?.postingStatus ?? null;
      case 'BILL':
        return (await prisma.supplierBill.findFirst({ where, select: { postingStatus: true } }))?.postingStatus ?? null;
      case 'PAYMENT':
        return (await prisma.supplierPayment.findFirst({ where, select: { postingStatus: true } }))?.postingStatus ?? null;
      case 'JOURNAL':
        return (await prisma.journalEntry.findFirst({ where, select: { status: true } }))?.status ?? null;
    }
  }

  list(prisma: TenantPrisma, kind: FinanceAttachmentKind, ownerId: string) {
    const args = { select: ROW_SELECT, orderBy: { createdAt: 'desc' as const } };
    switch (kind) {
      case 'INVOICE':
        return prisma.clientInvoiceAttachment.findMany({ where: { clientInvoiceId: ownerId }, ...args });
      case 'RECEIPT':
        return prisma.paymentReceiptAttachment.findMany({ where: { paymentReceiptId: ownerId }, ...args });
      case 'BILL':
        return prisma.supplierBillAttachment.findMany({ where: { supplierBillId: ownerId }, ...args });
      case 'PAYMENT':
        return prisma.supplierPaymentAttachment.findMany({ where: { supplierPaymentId: ownerId }, ...args });
      case 'JOURNAL':
        return prisma.journalEntryAttachment.findMany({ where: { journalEntryId: ownerId }, ...args });
    }
  }

  create(prisma: TenantPrisma, kind: FinanceAttachmentKind, ownerId: string, data: CreateFinanceAttachmentData) {
    const select = ROW_SELECT;
    switch (kind) {
      case 'INVOICE':
        return prisma.clientInvoiceAttachment.create({ data: { ...data, clientInvoiceId: ownerId }, select });
      case 'RECEIPT':
        return prisma.paymentReceiptAttachment.create({ data: { ...data, paymentReceiptId: ownerId }, select });
      case 'BILL':
        return prisma.supplierBillAttachment.create({ data: { ...data, supplierBillId: ownerId }, select });
      case 'PAYMENT':
        return prisma.supplierPaymentAttachment.create({ data: { ...data, supplierPaymentId: ownerId }, select });
      case 'JOURNAL':
        return prisma.journalEntryAttachment.create({ data: { ...data, journalEntryId: ownerId }, select });
    }
  }

  /** Scoped by BOTH ids: an attachment id alone must never reach a document it does not belong to. */
  findOwned(prisma: TenantPrisma, kind: FinanceAttachmentKind, ownerId: string, attachmentId: string) {
    const select = OWNED_SELECT;
    switch (kind) {
      case 'INVOICE':
        return prisma.clientInvoiceAttachment.findFirst({ where: { id: attachmentId, clientInvoiceId: ownerId }, select });
      case 'RECEIPT':
        return prisma.paymentReceiptAttachment.findFirst({ where: { id: attachmentId, paymentReceiptId: ownerId }, select });
      case 'BILL':
        return prisma.supplierBillAttachment.findFirst({ where: { id: attachmentId, supplierBillId: ownerId }, select });
      case 'PAYMENT':
        return prisma.supplierPaymentAttachment.findFirst({ where: { id: attachmentId, supplierPaymentId: ownerId }, select });
      case 'JOURNAL':
        return prisma.journalEntryAttachment.findFirst({ where: { id: attachmentId, journalEntryId: ownerId }, select });
    }
  }

  delete(prisma: TenantPrisma, kind: FinanceAttachmentKind, attachmentId: string) {
    const where = { id: attachmentId };
    switch (kind) {
      case 'INVOICE':
        return prisma.clientInvoiceAttachment.delete({ where });
      case 'RECEIPT':
        return prisma.paymentReceiptAttachment.delete({ where });
      case 'BILL':
        return prisma.supplierBillAttachment.delete({ where });
      case 'PAYMENT':
        return prisma.supplierPaymentAttachment.delete({ where });
      case 'JOURNAL':
        return prisma.journalEntryAttachment.delete({ where });
    }
  }

  async fileIds(prisma: TenantPrisma, kind: FinanceAttachmentKind, ownerId: string): Promise<string[]> {
    return (await this.list(prisma, kind, ownerId)).map((row) => row.platformFile.id);
  }

  findFileStatus(prisma: TenantPrisma, organizationId: string, fileId: string) {
    return prisma.platformFile.findFirst({
      where: { id: fileId, organizationId },
      select: { id: true, status: true, lifecycle: true, uploadedBy: true },
    });
  }
}
