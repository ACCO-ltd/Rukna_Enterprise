import { Injectable } from '@nestjs/common';
import type { PrismaClient, PaymentReceipt, ClientReceiptAllocation } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { IpcPaymentStatus, IpcPaymentStatusResponse } from '@erp/types';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * A receipt belongs to a project when any of its allocations (any posting state) applies it to a
 * client invoice of that project — a receipt has no project of its own. A receipt split across
 * projects appears under each; an unallocated receipt (on account) belongs to none (ADR-043).
 */
export function paymentReceiptProjectWhere(projectId: string) {
  return { clientAllocations: { some: { invoice: { projectId } } } };
}

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
      bankAccountId?: string;
      receiptDate: Date;
      accountingDate: Date;
      totalAmount: string;
      currencyCode: string;
      paymentMethod?: string;
      /** PM-1 — the payment method's proof (instrument number, issuer, date, payer). */
      details?: Partial<Pick<PaymentReceipt, 'instrumentNumber' | 'issuer' | 'instrumentDate' | 'payerName' | 'payerAccount' | 'receivedBy'>>;
      reference?: string;
      notes?: string;
      createdBy: string;
    },
  ) {
    return prisma.paymentReceipt.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        bankAccountId: data.bankAccountId ?? null,
        ...data.details,
        receiptDate: data.receiptDate,
        accountingDate: data.accountingDate,
        totalAmount: new Decimal(data.totalAmount),
        allocatedAmount: new Decimal(0),
        unallocatedAmount: new Decimal(data.totalAmount),
        currencyCode: data.currencyCode,
        paymentMethod: data.paymentMethod ?? null,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        createdBy: data.createdBy,
      },
    });
  }

  findAll(prisma: TenantPrisma, organizationId: string, clientId?: string, projectId?: string) {
    return prisma.paymentReceipt.findMany({
      where: {
        organizationId,
        ...(clientId ? { clientId } : {}),
        ...(projectId ? paymentReceiptProjectWhere(projectId) : {}),
      },
      // Same-day receipts newest number first, so the list reads in the order they were posted.
      orderBy: [{ receiptDate: 'desc' }, { receiptNumber: 'desc' }, { createdAt: 'desc' }],
      include: { bankAccount: { select: { bankName: true, accountName: true } } },
    });
  }

  /**
   * RC-7 — what the receipt page shows beside the receipt: each application with its invoice's
   * number and dates and whether it was made when the receipt posted (undone only by reversing the
   * receipt) or later; the bank account; and what was paid back from it (AR-5).
   */
  async findDetail(prisma: TenantPrisma, receipt: PaymentReceipt) {
    const [allocations, bankAccount, refunded] = await Promise.all([
      prisma.clientReceiptAllocation.findMany({
        where: { paymentReceiptId: receipt.id },
        orderBy: { createdAt: 'desc' },
        include: { invoice: { select: { invoiceNumber: true, invoiceDate: true, dueDate: true, totalAmount: true } } },
      }),
      this.bankAccountOf(prisma, receipt),
      prisma.clientRefund.aggregate({ where: { receiptId: receipt.id, status: 'POSTED' }, _sum: { amount: true } }),
    ]);
    return {
      allocations: allocations.map(({ invoice, ...a }) => ({
        ...a,
        atPosting: Boolean(receipt.postedJournalEntryId) && a.journalEntryId === receipt.postedJournalEntryId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        invoiceDueDate: invoice.dueDate,
        invoiceTotal: invoice.totalAmount,
      })),
      bankAccount,
      refundedAmount: new Decimal(refunded._sum.amount?.toString() ?? '0').toFixed(2),
    };
  }

  /**
   * The bank account a receipt landed in. Receipts posted through the two-step path before RC-3
   * named the bank by GL code only and left `bankAccountId` empty; recover the account from the
   * posting journal's bank line when it is a registered bank account.
   */
  async bankAccountOf(
    prisma: TenantPrisma,
    receipt: Pick<PaymentReceipt, 'organizationId' | 'bankAccountId' | 'postedJournalEntryId'>,
  ): Promise<{ id: string; bankName: string; accountName: string } | null> {
    if (receipt.bankAccountId) {
      return prisma.bankAccount.findFirst({
        where: { id: receipt.bankAccountId, organizationId: receipt.organizationId },
        select: { id: true, bankName: true, accountName: true },
      });
    }
    if (!receipt.postedJournalEntryId) return null;
    const bankLine = await prisma.journalLine.findFirst({
      where: { journalEntryId: receipt.postedJournalEntryId, sourceSubledgerType: 'BANK' },
      select: { accountId: true },
    });
    if (!bankLine) return null;
    return prisma.bankAccount.findFirst({
      where: { organizationId: receipt.organizationId, glAccountId: bankLine.accountId },
      select: { id: true, bankName: true, accountName: true },
    });
  }

  markPosted(
    prisma: TenantPrisma,
    id: string,
    journalEntryId: string,
    postedBy: string,
    allocatedAmount: Decimal,
    unallocatedAmount: Decimal,
    receiptNumber: string,
  ) {
    return prisma.paymentReceipt.update({
      where: { id },
      data: {
        receiptNumber,
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

  /** Records the GL journal of an allocation created before its journal was posted. */
  linkAllocationJournal(
    prisma: TenantPrisma,
    allocationId: string,
    journalEntryId: string,
  ): Promise<ClientReceiptAllocation> {
    return prisma.clientReceiptAllocation.update({
      where: { id: allocationId },
      data: { journalEntryId },
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
   * from the retired finance module in BE-2). Settlement is measured against the
   * ClientInvoice raised from the effective IPC (`sourceIpcId`), never against `netCertified`
   * (D2). Every figure is reported separately so no two bases are ever compared. An IPC with
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
      select: { id: true, totalAmount: true },
    });

    if (!invoice) {
      return {
        netCertified: netCertified.toFixed(2),
        invoiceTotal: null,
        totalReceived: '0.00',
        outstanding: null,
        paidPercent: '0',
        status: 'UNINVOICED',
        totalAllocated: '0.00',
      };
    }

    const invoiceTotal = new Decimal(invoice.totalAmount.toString());

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
      invoiceTotal: invoiceTotal.toFixed(2),
      totalReceived: totalReceived.toFixed(2),
      outstanding: outstanding.toFixed(2),
      paidPercent: paidPercent.toFixed(1),
      status,
      totalAllocated: totalReceived.toFixed(2),
    };
  }

  // ─── Receipt document + WhatsApp (WhatsApp V1 step 3) ──────────────────────

  /**
   * What the receipt PDF and the WhatsApp message are built from: the receipt, its client (with
   * contacts, for recipients), the org's branding, and the allocations made WHEN IT WAS POSTED —
   * the ones sharing the posting journal. Later allocations (EVT-AR-005) are not part of the
   * receipt as issued; initial allocations can only be undone by reversing the whole receipt, so
   * this set is fixed for as long as the receipt is POSTED.
   */
  async findForDocument(prisma: TenantPrisma, organizationId: string, id: string) {
    const receipt = await prisma.paymentReceipt.findFirst({
      where: { id, organizationId },
      include: {
        client: {
          select: {
            name: true,
            address: true,
            city: true,
            countryCode: true,
            contacts: {
              select: { id: true, name: true, role: true, phone: true, whatsappPhone: true, isPrimary: true },
            },
          },
        },
        organization: {
          select: {
            name: true,
            logoFileId: true,
            legalAddress: true,
            taxRegistrationNumber: true,
            brandColorHex: true,
            invoiceFooterNote: true,
            invoiceTemplate: true,
          },
        },
        bankAccount: { select: { bankName: true, accountName: true } },
        documentFile: { select: { lifecycle: true } },
      },
    });
    if (!receipt) return null;

    const initialAllocations = receipt.postedJournalEntryId
      ? await prisma.clientReceiptAllocation.findMany({
          where: { paymentReceiptId: id, journalEntryId: receipt.postedJournalEntryId, postingStatus: 'POSTED' },
          orderBy: { createdAt: 'asc' },
          select: { allocatedAmount: true, clientInvoiceId: true, invoice: { select: { invoiceNumber: true } } },
        })
      : [];

    const bankAccount = receipt.bankAccount ?? (await this.bankAccountOf(prisma, receipt));

    return { ...receipt, bankAccount, initialAllocations };
  }

  /**
   * Compare-and-set: bind the rendered PDF only if none is bound yet. False = a concurrent first
   * request won; the caller discards its own file and uses the winner's.
   */
  async bindDocumentFileIdIfUnset(prisma: TenantPrisma, id: string, documentFileId: string): Promise<boolean> {
    const { count } = await prisma.paymentReceipt.updateMany({
      where: { id, documentFileId: null },
      data: { documentFileId },
    });
    return count === 1;
  }

  findDocumentFileId(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.paymentReceipt
      .findFirst({ where: { id, organizationId }, select: { documentFileId: true } })
      .then((r) => r?.documentFileId ?? null);
  }
}
