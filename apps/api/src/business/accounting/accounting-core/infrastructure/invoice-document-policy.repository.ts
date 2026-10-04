import { Injectable } from '@nestjs/common';
import { Prisma, type InvoiceDocumentPolicy, type PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * The invoice document settings as an invoice freezes them: plain printable values, resolved from
 * the policy's ids at the moment of the snapshot (so a later edit of the bank account or the
 * signatory's name never reaches an invoice already raised). Stored in
 * `ClientInvoice.billingAddressSnapshot.org.invoiceDocument`.
 */
export interface InvoiceDocumentSnapshot {
  bank: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    swiftCode: string | null;
    currencyCode: string;
  } | null;
  notes: string | null;
  signatory: { name: string; title: string | null } | null;
}

export interface InvoiceDocumentPolicyWrite {
  bankAccountId: string | null;
  notes: string | null;
  signatoryUserId: string | null;
  signatoryTitle: string | null;
}

/** The organisation's invoice document settings (`InvoiceDocumentPolicy`). */
@Injectable()
export class InvoiceDocumentPolicyRepository {
  find(prisma: TenantPrisma, organizationId: string): Promise<InvoiceDocumentPolicy | null> {
    return prisma.invoiceDocumentPolicy.findUnique({ where: { organizationId } });
  }

  upsert(prisma: TenantPrisma, organizationId: string, data: InvoiceDocumentPolicyWrite, updatedBy: string) {
    return prisma.invoiceDocumentPolicy.upsert({
      where: { organizationId },
      create: { organizationId, ...data, updatedBy },
      update: { ...data, updatedBy },
    });
  }

  async recordAudit(
    tx: TenantPrisma,
    data: { organizationId: string; userId: string; before: object | null; after: object },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: data.userId,
        orgId: data.organizationId,
        action: 'INVOICE_DOCUMENT_SETTINGS_UPDATED',
        resource: 'invoice-document-settings',
        resourceId: data.organizationId,
        before: (data.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: data.after as Prisma.InputJsonValue,
        sourceCommand: 'invoice-document-settings.update',
      },
    });
  }
}

/**
 * Resolve the settings to the values an invoice prints. A bank account that is missing, closed or
 * not open for receipts prints nothing (no Payment Information card rather than stale details); a
 * signatory who is no longer an active user of the organisation leaves the signature line blank.
 *
 * A plain function on the tenant client (not a service method) so the invoice snapshot can take it
 * inside the invoice-creating transaction.
 */
export async function resolveInvoiceDocumentSnapshot(
  prisma: TenantPrisma,
  organizationId: string,
): Promise<InvoiceDocumentSnapshot> {
  const policy = await prisma.invoiceDocumentPolicy.findUnique({ where: { organizationId } });
  if (!policy) return { bank: null, notes: null, signatory: null };

  const [bank, user] = await Promise.all([
    policy.bankAccountId
      ? prisma.bankAccount.findFirst({
          where: { id: policy.bankAccountId, organizationId, status: 'ACTIVE', allowsReceipts: true },
          select: { bankName: true, accountName: true, accountNumber: true, swiftCode: true, currencyCode: true },
        })
      : null,
    policy.signatoryUserId
      ? prisma.user.findFirst({
          where: { id: policy.signatoryUserId, organizationId, status: 'ACTIVE' },
          select: { firstName: true, lastName: true },
        })
      : null,
  ]);

  const name = user ? `${user.firstName} ${user.lastName}`.trim() : '';
  return {
    bank: bank
      ? {
          bankName: bank.bankName,
          accountName: bank.accountName,
          accountNumber: bank.accountNumber,
          swiftCode: bank.swiftCode,
          currencyCode: bank.currencyCode,
        }
      : null,
    notes: policy.notes?.trim() ? policy.notes : null,
    signatory: name ? { name, title: policy.signatoryTitle?.trim() || null } : null,
  };
}
