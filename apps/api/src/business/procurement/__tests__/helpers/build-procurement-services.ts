/**
 * Instantiates all Sprint 5 procurement services + the AP SupplierBillService
 * (with CommitmentLedgerRepository wired) without NestJS DI.
 *
 * Pattern mirrors apps/api/src/business/accounting/__tests__/helpers/build-services.ts.
 */

import { PrismaClient } from '@prisma/client';
import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

// ── Catalogue ─────────────────────────────────────────────────────────────────
import { UomRepository }              from '../../catalogue/infrastructure/uom.repository.js';
import { MaterialCategoryRepository } from '../../catalogue/infrastructure/material-category.repository.js';
import { SpendCategoryRepository }    from '../../catalogue/infrastructure/spend-category.repository.js';
import { MaterialRepository }         from '../../catalogue/infrastructure/material.repository.js';
import { MaterialService }            from '../../catalogue/application/material.service.js';

// ── Material Requests ─────────────────────────────────────────────────────────
import { MaterialRequestRepository }  from '../../material-requests/infrastructure/material-request.repository.js';
import { MaterialRequestService }     from '../../material-requests/application/material-request.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';

// ── Purchase Orders ───────────────────────────────────────────────────────────
import { PurchaseOrderRepository }    from '../../purchase-orders/infrastructure/purchase-order.repository.js';
import { PurchaseOrderService }       from '../../purchase-orders/application/purchase-order.service.js';

// ── Goods Receipts ────────────────────────────────────────────────────────────
import { GoodsReceiptRepository }     from '../../goods-receipts/infrastructure/goods-receipt.repository.js';
import { GoodsReceiptService }        from '../../goods-receipts/application/goods-receipt.service.js';

// ── Bill Matching ─────────────────────────────────────────────────────────────
import { BillMatchRepository }        from '../../bill-matching/infrastructure/bill-match.repository.js';
import { BillMatchingService }        from '../../bill-matching/application/bill-matching.service.js';

// ── Commitment Ledger ─────────────────────────────────────────────────────────
import { CommitmentLedgerRepository } from '../../commitment-ledger/infrastructure/commitment-ledger.repository.js';

// ── Accounting (AP + posting) ─────────────────────────────────────────────────
import { AccountingPostingService }   from '../../../accounting/accounting-core/infrastructure/accounting-posting.service.js';
import { JournalRepository }          from '../../../accounting/accounting-core/infrastructure/journal.repository.js';
import { DocumentSequenceRepository } from '../../../accounting/accounting-core/infrastructure/document-sequence.repository.js';
import { AccountRepository }          from '../../../accounting/accounting-core/infrastructure/account.repository.js';
import { SupplierBillRepository }     from '../../../accounting/accounts-payable/infrastructure/supplier-bill.repository.js';
import { SupplierBillService }        from '../../../accounting/accounts-payable/application/supplier-bill.service.js';

export interface ProcurementServices {
  prisma: PrismaClient;
  // Catalogue
  uomRepo: UomRepository;
  materialCategoryRepo: MaterialCategoryRepository;
  spendCategoryRepo: SpendCategoryRepository;
  materialRepo: MaterialRepository;
  materialService: MaterialService;
  // MR
  mrRepo: MaterialRequestRepository;
  mrService: MaterialRequestService;
  // PO
  poRepo: PurchaseOrderRepository;
  poService: PurchaseOrderService;
  // GRN
  grnRepo: GoodsReceiptRepository;
  grnService: GoodsReceiptService;
  // Bill Matching
  billMatchRepo: BillMatchRepository;
  billMatchingService: BillMatchingService;
  // Commitment Ledger
  commitmentRepo: CommitmentLedgerRepository;
  // AP (bill posting — needed for ACCRUED→ACTUAL tests)
  supplierBillRepo: SupplierBillRepository;
  supplierBillService: SupplierBillService;
}

export function buildProcurementServices(prisma: PrismaClient): ProcurementServices {
  const tenancy = { getClient: () => prisma } as unknown as TenancyService;

  // ── Repositories ──────────────────────────────────────────────────────────
  const uomRepo              = new UomRepository();
  const materialCategoryRepo = new MaterialCategoryRepository();
  const spendCategoryRepo    = new SpendCategoryRepository();
  const materialRepo         = new MaterialRepository();
  const mrRepo               = new MaterialRequestRepository();
  const poRepo               = new PurchaseOrderRepository();
  const grnRepo              = new GoodsReceiptRepository();
  const billMatchRepo        = new BillMatchRepository();
  const commitmentRepo       = new CommitmentLedgerRepository();

  // ── Accounting ─────────────────────────────────────────────────────────────
  const journalRepo      = new JournalRepository();
  const sequenceRepo     = new DocumentSequenceRepository();
  const accountRepo      = new AccountRepository();
  const postingService   = new AccountingPostingService(sequenceRepo, journalRepo);
  const supplierBillRepo = new SupplierBillRepository();

  // ── Services ──────────────────────────────────────────────────────────────
  const materialService = new MaterialService(tenancy, materialRepo, uomRepo, materialCategoryRepo, spendCategoryRepo);
  const projectAccess   = new ProjectAccessService(tenancy);
  const mrService       = new MaterialRequestService(tenancy, mrRepo, materialRepo, uomRepo, projectAccess);
  const poService       = new PurchaseOrderService(tenancy, poRepo, materialRepo, uomRepo, commitmentRepo);
  const grnService      = new GoodsReceiptService(tenancy, grnRepo, poRepo, commitmentRepo);
  const billMatchingService = new BillMatchingService(tenancy, billMatchRepo);

  // SupplierBillService with CommitmentLedgerRepository wired (needed for ACCRUED→ACTUAL)
  const supplierBillService = new SupplierBillService(
    tenancy,
    supplierBillRepo,
    accountRepo,
    sequenceRepo,
    postingService,
    commitmentRepo,
  );

  return {
    prisma,
    uomRepo, materialCategoryRepo, spendCategoryRepo, materialRepo, materialService,
    mrRepo, mrService,
    poRepo, poService,
    grnRepo, grnService,
    billMatchRepo, billMatchingService,
    commitmentRepo,
    supplierBillRepo, supplierBillService,
  };
}
