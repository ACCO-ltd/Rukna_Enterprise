import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { PrismaClient, PaymentReceipt } from '@prisma/client';
import type { IpcPaymentStatus, IpcPaymentStatusResponse } from '@erp/types';

export type ReceiptFull = PaymentReceipt & {
  allocations: import('@prisma/client').ReceiptAllocation[];
};

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class FinancePrismaRepository {
  findAll(prisma: TenantPrisma, organizationId: string, clientId?: string) {
    return prisma.paymentReceipt.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      orderBy: { receiptDate: 'desc' },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<ReceiptFull | null> {
    return prisma.paymentReceipt.findFirst({
      where: { id, organizationId },
      include: { allocations: { orderBy: { allocatedAt: 'desc' } } },
    }) as Promise<ReceiptFull | null>;
  }

  create(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      clientId: string;
      receiptDate: Date;
      accountingDate: Date;
      totalAmount: string;
      currencyCode: string;
      reference?: string;
      notes?: string;
      createdBy: string;
    },
  ) {
    // A receipt is fully unallocated when recorded: unallocatedAmount = totalAmount,
    // allocatedAmount = 0. The schema invariant is totalAmount = allocatedAmount +
    // unallocatedAmount (always), and unallocatedAmount has no default — omitting it
    // (the previous `data as never` path) made every POST /receipts fail at the DB.
    return prisma.paymentReceipt.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        receiptDate: data.receiptDate,
        accountingDate: data.accountingDate,
        totalAmount: new Decimal(data.totalAmount),
        allocatedAmount: new Decimal(0),
        unallocatedAmount: new Decimal(data.totalAmount),
        currencyCode: data.currencyCode,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        createdBy: data.createdBy,
      },
    });
  }

  // Returns the sum of all allocated amounts for a receipt as a Decimal string.
  getTotalAllocated(prisma: TenantPrisma, receiptId: string): Promise<string> {
    return prisma.receiptAllocation
      .aggregate({ where: { receiptId }, _sum: { allocatedAmount: true } })
      .then((r) => new Decimal(r._sum.allocatedAmount?.toString() ?? '0').toFixed(2));
  }

  addAllocation(
    prisma: TenantPrisma,
    data: {
      receiptId: string;
      certificateId: string;
      allocatedAmount: string;
      allocatedBy: string;
    },
  ) {
    return prisma.receiptAllocation.create({ data: data as never });
  }

  findAllocation(prisma: TenantPrisma, allocationId: string) {
    return prisma.receiptAllocation.findUnique({ where: { id: allocationId } });
  }

  removeAllocation(prisma: TenantPrisma, allocationId: string) {
    return prisma.receiptAllocation.delete({ where: { id: allocationId } });
  }

  /**
   * ADR-024 ACC-SET-001 — IPC payment status derived from the invoice, not the IPC.
   *
   * The IPC certifies work (pre-VAT). Billing raises a ClientInvoice from the effective IPC
   * (`sourceIpcId`), which carries VAT, and receipts settle THAT invoice. So payment status is
   * measured against the VAT-inclusive invoice total — never against `netCertified` (D2). Every
   * figure is reported separately so no two tax bases are ever compared. An IPC with no live
   * (POSTED, non-reversed) invoice is UNINVOICED: certified, but not yet billed.
   */
  async getCertificatePaymentSummary(
    prisma: TenantPrisma,
    certificateId: string,
  ): Promise<IpcPaymentStatusResponse> {
    const cert = await prisma.interimPaymentCertificate.findUnique({
      where: { id: certificateId },
      select: {
        items: { select: { certifiedAmount: true } },
        deductions: { select: { amount: true } },
      },
    });

    const netCertified = (cert?.items ?? [])
      .reduce((s, i) => s.plus(new Decimal(i.certifiedAmount.toString())), new Decimal(0))
      .minus(
        (cert?.deductions ?? []).reduce(
          (s, d) => s.plus(new Decimal(d.amount.toString())),
          new Decimal(0),
        ),
      );

    const invoice = await prisma.clientInvoice.findFirst({
      where: { sourceIpcId: certificateId, postingStatus: 'POSTED', reversalJournalEntryId: null },
      select: { id: true, vatAmount: true, totalAmount: true },
    });

    if (!invoice) {
      return {
        netCertified: netCertified.toFixed(2),
        vatAmount: '0.00',
        invoiceTotal: null,
        totalReceived: '0.00',
        outstanding: null,
        paidPercent: '0',
        status: 'UNINVOICED',
        totalAllocated: '0.00',
      };
    }

    const invoiceTotal = new Decimal(invoice.totalAmount.toString());
    const vatAmount = new Decimal(invoice.vatAmount.toString());

    const received = await prisma.clientReceiptAllocation.aggregate({
      where: { clientInvoiceId: invoice.id, postingStatus: 'POSTED' },
      _sum: { allocatedAmount: true },
    });
    const totalReceived = new Decimal(received._sum.allocatedAmount?.toString() ?? '0');
    const outstanding = Decimal.max(invoiceTotal.minus(totalReceived), new Decimal(0));

    let status: IpcPaymentStatus = 'UNPAID';
    if (invoiceTotal.greaterThan(0) && totalReceived.greaterThanOrEqualTo(invoiceTotal)) {
      status = 'PAID';
    } else if (totalReceived.greaterThan(0)) {
      status = 'PARTIALLY_PAID';
    }

    const paidPercent = invoiceTotal.greaterThan(0)
      ? totalReceived.dividedBy(invoiceTotal).times(100)
      : new Decimal(0);

    return {
      netCertified: netCertified.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      invoiceTotal: invoiceTotal.toFixed(2),
      totalReceived: totalReceived.toFixed(2),
      outstanding: outstanding.toFixed(2),
      paidPercent: paidPercent.toFixed(1),
      status,
      totalAllocated: totalReceived.toFixed(2),
    };
  }
}
