import { Injectable } from '@nestjs/common';
import type { PrismaClient, PaymentReceipt, ClientReceiptAllocation } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { IpcPaymentStatus, IpcPaymentStatusResponse } from '@erp/types';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class PaymentReceiptArRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<PaymentReceipt | null> {
    return prisma.paymentReceipt.findFirst({ where: { id, organizationId } });
  }

  // ACC-SET-001 BE-2: receipt creation moved here from the retired finance module. A receipt is
  // fully unallocated when recorded (unallocatedAmount = totalAmount, allocatedAmount = 0).
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

  findAll(prisma: TenantPrisma, organizationId: string, clientId?: string) {
    return prisma.paymentReceipt.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      orderBy: { receiptDate: 'desc' },
    });
  }

  markPosted(
    prisma: TenantPrisma,
    id: string,
    journalEntryId: string,
    postedBy: string,
    allocatedAmount: Decimal,
    unallocatedAmount: Decimal,
  ) {
    return prisma.paymentReceipt.update({
      where: { id },
      data: {
        postingStatus: 'POSTED',
        postedJournalEntryId: journalEntryId,
        postedAt: new Date(),
        postedBy,
        documentStatus: 'APPROVED',
        allocatedAmount,
        unallocatedAmount,
      },
    });
  }

  updateAllocations(
    prisma: TenantPrisma,
    id: string,
    allocatedAmount: Decimal,
    unallocatedAmount: Decimal,
  ) {
    return prisma.paymentReceipt.update({
      where: { id },
      data: { allocatedAmount, unallocatedAmount },
    });
  }

  createAllocation(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      paymentReceiptId: string;
      clientInvoiceId: string;
      allocatedAmount: Decimal;
      allocationDate: Date;
      journalEntryId?: string;
      postingStatus: string;
      createdBy: string;
    },
  ): Promise<ClientReceiptAllocation> {
    return prisma.clientReceiptAllocation.create({
      data: {
        organizationId: data.organizationId,
        paymentReceiptId: data.paymentReceiptId,
        clientInvoiceId: data.clientInvoiceId,
        allocatedAmount: data.allocatedAmount,
        allocationDate: data.allocationDate,
        journalEntryId: data.journalEntryId ?? null,
        postingStatus: data.postingStatus as never,
        createdBy: data.createdBy,
      },
    });
  }

  /**
   * All allocations on a receipt for the receipt workspace (ACC-SET-001 FE-1) — including
   * REVERSED ones, which the panel renders struck-through as an audit trail rather than
   * silently dropping. Balances are unaffected: they are tracked on the receipt row, and the
   * applied total excludes reversed allocations. Newest first.
   */
  findAllocationsByReceipt(prisma: TenantPrisma, paymentReceiptId: string) {
    return prisma.clientReceiptAllocation.findMany({
      where: { paymentReceiptId },
      orderBy: { createdAt: 'desc' },
    });
  }

  getTotalAllocatedToInvoice(prisma: TenantPrisma, clientInvoiceId: string): Promise<Decimal> {
    return prisma.clientReceiptAllocation
      .aggregate({
        where: { clientInvoiceId, postingStatus: { in: ['POSTED'] } },
        _sum: { allocatedAmount: true },
      })
      .then((r) => new Decimal(r._sum.allocatedAmount?.toString() ?? '0'));
  }

  /**
   * ADR-024 ACC-SET-001 — IPC payment status derived from the invoice, not the IPC (moved here
   * from the retired finance module in BE-2). Settlement is measured against the VAT-inclusive
   * ClientInvoice raised from the effective IPC (`sourceIpcId`), never against `netCertified`
   * (D2). Every figure is reported separately so no two tax bases are ever compared. An IPC with
   * no live (POSTED, non-reversed) invoice is UNINVOICED: certified, but not yet billed.
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
