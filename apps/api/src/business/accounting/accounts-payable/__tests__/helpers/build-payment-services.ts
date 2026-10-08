/**
 * ADR-045 — real AP + procurement + quotation services over one Prisma client (no Nest DI): real
 * posting engine, real governance and SoD, real audit outbox, real settlement read model.
 */
import type { PrismaClient } from '@prisma/client';

import {
  buildQuotationServices,
  type QuotationServiceOptions,
} from '../../../../procurement/quotations/__tests__/helpers/build-quotation-services.js';
import { AccountingPostingService } from '../../../accounting-core/infrastructure/accounting-posting.service.js';
import { JournalRepository } from '../../../accounting-core/infrastructure/journal.repository.js';
import { DocumentSequenceRepository } from '../../../accounting-core/infrastructure/document-sequence.repository.js';
import { AccountRepository } from '../../../accounting-core/infrastructure/account.repository.js';
import { BankAccountSignatoryService } from '../../../accounting-core/application/bank-account-signatory.service.js';
import { BankAccountSignatoryRepository } from '../../../accounting-core/infrastructure/bank-account-signatory.repository.js';
import { BankAccountRepository } from '../../../accounting-core/infrastructure/bank-account.repository.js';
import { SupplierBillRepository } from '../../infrastructure/supplier-bill.repository.js';
import { SupplierPaymentRepository } from '../../infrastructure/supplier-payment.repository.js';
import { PurchaseAllocationRepository } from '../../infrastructure/purchase-allocation.repository.js';
import { SupplierBillService } from '../../application/supplier-bill.service.js';
import { SupplierPaymentService } from '../../application/supplier-payment.service.js';
import { BillMatchingService } from '../../../../procurement/bill-matching/application/bill-matching.service.js';
import { BillMatchRepository } from '../../../../procurement/bill-matching/infrastructure/bill-match.repository.js';
import { CommitmentLedgerWriter } from '../../../../procurement/commitment-ledger/application/commitment-ledger-writer.service.js';
import { CommitmentLedgerRepository } from '../../../../procurement/commitment-ledger/infrastructure/commitment-ledger.repository.js';
import { PurchaseOrderService } from '../../../../procurement/purchase-orders/application/purchase-order.service.js';
import { PurchaseOrderAttachmentRepository } from '../../../../procurement/purchase-orders/infrastructure/purchase-order-attachment.repository.js';
import { SettlementQueryService } from '../../../../procurement/purchase-orders/application/settlement-query.service.js';
import { SettlementQueryRepository } from '../../../../procurement/purchase-orders/infrastructure/settlement-query.repository.js';
import { MaterialRepository } from '../../../../procurement/catalogue/infrastructure/material.repository.js';
import { UomRepository } from '../../../../procurement/catalogue/infrastructure/uom.repository.js';
import { GoodsReceiptService } from '../../../../procurement/goods-receipts/application/goods-receipt.service.js';
import { GoodsReceiptRepository } from '../../../../procurement/goods-receipts/infrastructure/goods-receipt.repository.js';
import { GrnAttachmentRepository } from '../../../../procurement/goods-receipts/infrastructure/grn-attachment.repository.js';
import { ProjectAccessService } from '../../../../../platform/project-access/project-access.service.js';
import { BuyerAdvanceService } from '../../application/buyer-advance.service.js';
import { BuyerAdvanceRepository } from '../../infrastructure/buyer-advance.repository.js';
import { AwardPaymentRepository } from '../../infrastructure/award-payment.repository.js';
import { AwardSupplierPaymentService } from '../../application/award-supplier-payment.service.js';
import { StoreDocumentSettlementService } from '../../application/store-document-settlement.service.js';
import { QuotationPaymentNotifier } from '../../../../procurement/quotations/application/quotation-payment-notifier.service.js';
import { NotificationWriter } from '../../../../../platform/notifications/application/notification-writer.service.js';
import { StoreDocumentService } from '../../../../procurement/store-documents/application/store-document.service.js';
import { StoreDocumentRepository } from '../../../../procurement/store-documents/infrastructure/store-document.repository.js';

export function buildPaymentServices(prisma: PrismaClient, options: QuotationServiceOptions = {}) {
  const q = buildQuotationServices(prisma, options);
  const { tenancy, audit, sod, commandGovernance } = q;
  const projectAccess = new ProjectAccessService(tenancy);

  const commitmentWriter = new CommitmentLedgerWriter(new CommitmentLedgerRepository());
  const settlement = new SettlementQueryService(tenancy, new SettlementQueryRepository(), projectAccess);
  const poService = new PurchaseOrderService(
    tenancy,
    q.poRepo,
    new PurchaseOrderAttachmentRepository(),
    new MaterialRepository(),
    new UomRepository(),
    commitmentWriter,
    audit,
    commandGovernance,
    sod,
    settlement,
  );
  const receiptExceptions = { isReceiptCleared: async () => false } as never;
  const grnService = new GoodsReceiptService(
    tenancy,
    new GoodsReceiptRepository(),
    new GrnAttachmentRepository(),
    q.poRepo,
    poService,
    commitmentWriter,
    audit,
    sod,
    receiptExceptions,
  );

  const accountRepo = new AccountRepository();
  const sequenceRepo = new DocumentSequenceRepository();
  const postingPort = new AccountingPostingService(sequenceRepo, new JournalRepository());
  const billMatching = new BillMatchingService(tenancy, new BillMatchRepository());
  const billRepo = new SupplierBillRepository();
  const bills = new SupplierBillService(
    tenancy,
    billRepo,
    accountRepo,
    sequenceRepo,
    postingPort,
    commitmentWriter,
    billMatching,
    commandGovernance,
    sod,
  );
  const signatories = new BankAccountSignatoryService(tenancy, new BankAccountSignatoryRepository(), new BankAccountRepository());
  // ADR-045 §5 — the real notifier on THIS PO service (PAYMENT_NEEDED on covered confirm) + AP events.
  const paymentNotifier = new QuotationPaymentNotifier(new NotificationWriter(), q.access, projectAccess, q.alerts, q.repo, poService);
  paymentNotifier.onModuleInit();
  const paymentRepo = new SupplierPaymentRepository();
  const purchaseAllocationRepo = new PurchaseAllocationRepository();
  const payments = new SupplierPaymentService(
    tenancy,
    paymentRepo,
    billRepo,
    purchaseAllocationRepo,
    accountRepo,
    sequenceRepo,
    postingPort,
    commandGovernance,
    sod,
    signatories,
    poService,
    audit,
    paymentNotifier,
  );
  const awardRepo = new AwardPaymentRepository();
  const advances = new BuyerAdvanceService(
    tenancy,
    new BuyerAdvanceRepository(),
    poService,
    postingPort,
    accountRepo,
    awardRepo,
    commandGovernance,
    q.approvals,
    sod,
    audit,
    paymentNotifier,
    q.paymentReadModel,
  );

  const awardPayments = new AwardSupplierPaymentService(
    tenancy,
    awardRepo,
    paymentRepo,
    purchaseAllocationRepo,
    payments,
    signatories,
    commandGovernance,
    q.approvals,
    sod,
    audit,
    poService,
    q.paymentReadModel,
  );
  const settlementSvc = new StoreDocumentSettlementService(
    tenancy,
    awardRepo,
    billRepo,
    bills,
    payments,
    advances,
    poService,
    audit,
    paymentNotifier,
  );
  const storeDocumentRepo = new StoreDocumentRepository();
  const storeDocuments = new StoreDocumentService(tenancy, storeDocumentRepo, q.access, projectAccess, audit, paymentNotifier);

  return {
    ...q,
    paymentNotifier,
    awardPayments,
    recordReceipt: settlementSvc,
    storeDocuments,
    storeDocumentRepo,
    awardRepo,
    advances,
    poService,
    settlement,
    grnService,
    billMatching,
    bills,
    payments,
    signatories,
    postingPort,
    accountRepo,
  };
}

export type PaymentServices = ReturnType<typeof buildPaymentServices>;
