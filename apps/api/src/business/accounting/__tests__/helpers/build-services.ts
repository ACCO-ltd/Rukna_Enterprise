/**
 * Instantiates all Phase 2 + Phase 3 accounting services without NestJS DI.
 * Injects a fake TenancyService whose getClient() returns the test PrismaClient.
 */

import { PrismaClient } from '@prisma/client';
import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

import { AccountingPostingService }   from '../../accounting-core/infrastructure/accounting-posting.service.js';
import { JournalRepository }          from '../../accounting-core/infrastructure/journal.repository.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { AccountRepository }          from '../../accounting-core/infrastructure/account.repository.js';

import { OpeningBalanceService }      from '../../accounting-core/application/opening-balance.service.js';
import { PostingAccountResolver }     from '../../accounting-core/application/posting-account-resolver.service.js';
import { ReconciliationService }      from '../../accounting-core/application/reconciliation.service.js';

import { ManualJournalService }       from '../../manual-journals/application/manual-journal.service.js';

import { ClientInvoiceRepository }   from '../../accounts-receivable/infrastructure/client-invoice.repository.js';
import { PaymentReceiptArRepository } from '../../accounts-receivable/infrastructure/payment-receipt-ar.repository.js';
import { ClientInvoiceService }      from '../../accounts-receivable/application/client-invoice.service.js';
import { CustomerReceiptService }    from '../../accounts-receivable/application/customer-receipt.service.js';

import { SupplierBillRepository }    from '../../accounts-payable/infrastructure/supplier-bill.repository.js';
import { SupplierPaymentRepository } from '../../accounts-payable/infrastructure/supplier-payment.repository.js';
import { SupplierBillService }       from '../../accounts-payable/application/supplier-bill.service.js';
import { SupplierPaymentService }    from '../../accounts-payable/application/supplier-payment.service.js';
import { CommitmentLedgerRepository } from '../../../procurement/commitment-ledger/infrastructure/commitment-ledger.repository.js';
import { CommitmentLedgerWriter }     from '../../../procurement/commitment-ledger/application/commitment-ledger-writer.service.js';
import { BillMatchRepository }        from '../../../procurement/bill-matching/infrastructure/bill-match.repository.js';
import { BillMatchingService }        from '../../../procurement/bill-matching/application/bill-matching.service.js';

// Workflows / governance seam (ADR-011)
import { WorkflowTriggerResolverService } from '../../../../platform/workflows/application/workflow-trigger-resolver.service.js';
import { WorkflowsPrismaRepository }      from '../../../../platform/workflows/infrastructure/workflows-prisma.repository.js';
import { CommandGovernanceService }       from '../../../../platform/workflows/application/command-governance.service.js';
import { SegregationOfDutiesService }      from '../../../../platform/workflows/application/segregation-of-duties.service.js';

// Phase 3
import { SnapshotService }           from '../../general-ledger/application/snapshot.service.js';
import { LedgerService }             from '../../general-ledger/application/ledger.service.js';
import { TrialBalanceService }       from '../../general-ledger/application/trial-balance.service.js';
import { PLReportService }           from '../../general-ledger/application/pl-report.service.js';
import { BalanceSheetService }       from '../../general-ledger/application/balance-sheet.service.js';
import { PeriodManagementService }   from '../../general-ledger/application/period-management.service.js';

export interface AccountingServices {
  prisma: PrismaClient;
  journalRepo: JournalRepository;
  sequenceRepo: DocumentSequenceRepository;
  accountRepo: AccountRepository;
  postingService: AccountingPostingService;
  openingBalanceService: OpeningBalanceService;
  reconciliationService: ReconciliationService;
  manualJournalService: ManualJournalService;
  clientInvoiceRepo: ClientInvoiceRepository;
  receiptRepo: PaymentReceiptArRepository;
  clientInvoiceService: ClientInvoiceService;
  customerReceiptService: CustomerReceiptService;
  supplierBillRepo: SupplierBillRepository;
  supplierPaymentRepo: SupplierPaymentRepository;
  supplierBillService: SupplierBillService;
  supplierPaymentService: SupplierPaymentService;
  // Phase 3
  snapshotService: SnapshotService;
  ledgerService: LedgerService;
  trialBalanceService: TrialBalanceService;
  plReportService: PLReportService;
  balanceSheetService: BalanceSheetService;
  periodManagementService: PeriodManagementService;
}

export function buildServices(prisma: PrismaClient): AccountingServices {
  // Fake TenancyService — getClient() returns the real test PrismaClient
  const tenancy = { getClient: () => prisma } as unknown as TenancyService;

  // Stateless repositories
  const journalRepo  = new JournalRepository();
  const sequenceRepo = new DocumentSequenceRepository();
  const accountRepo  = new AccountRepository();

  // Core posting engine
  const postingService = new AccountingPostingService(sequenceRepo, journalRepo);

  // ADR-022: SoD is exercised in dedicated specs; the shared harness no-ops it so existing
  // fixtures (which reuse a single actor id) are not newly blocked by segregation rules.
  const sod = { assertAllowed: async () => undefined } as unknown as SegregationOfDutiesService;

  // Core application services
  const openingBalanceService = new OpeningBalanceService(tenancy, accountRepo, journalRepo, sequenceRepo, postingService);
  const reconciliationService = new ReconciliationService(tenancy, accountRepo, journalRepo);

  // Governance seam (ADR-011) — shared by manual journals and AP.
  const commandGovernance = new CommandGovernanceService(
    new WorkflowTriggerResolverService(tenancy),
    new WorkflowsPrismaRepository(tenancy),
  );

  // Manual journals
  const manualJournalService = new ManualJournalService(tenancy, journalRepo, sequenceRepo, postingService, commandGovernance, sod);

  // AR
  const postingAccountResolver = new PostingAccountResolver(accountRepo);
  const clientInvoiceRepo = new ClientInvoiceRepository();
  const receiptRepo       = new PaymentReceiptArRepository();
  const clientInvoiceService   = new ClientInvoiceService(tenancy, clientInvoiceRepo, sequenceRepo, postingAccountResolver, postingService);
  const customerReceiptService = new CustomerReceiptService(tenancy, receiptRepo, clientInvoiceRepo, accountRepo, postingAccountResolver, postingService);

  // AP
  const supplierBillRepo    = new SupplierBillRepository();
  const supplierPaymentRepo = new SupplierPaymentRepository();
  const commitmentWriter    = new CommitmentLedgerWriter(new CommitmentLedgerRepository());
  // ADR-022 Phase 4: the shared harness treats accounts as having no signatories (no dual control),
  // so existing payment tests keep the APPROVED → post path. Release is covered in dedicated specs.
  const signatoryService = {
    requiresDualControl: async () => false,
    isActiveSignatory: async () => false,
  } as unknown as import('../../accounting-core/application/bank-account-signatory.service.js').BankAccountSignatoryService;
  const billMatchingService    = new BillMatchingService(tenancy, new BillMatchRepository());
  const supplierBillService    = new SupplierBillService(tenancy, supplierBillRepo, accountRepo, sequenceRepo, postingService, commitmentWriter, billMatchingService, commandGovernance, sod);
  const supplierPaymentService = new SupplierPaymentService(tenancy, supplierPaymentRepo, supplierBillRepo, accountRepo, sequenceRepo, postingService, commandGovernance, sod, signatoryService);

  // Phase 3 — GL reports and period management
  const snapshotService        = new SnapshotService(tenancy);
  const ledgerService          = new LedgerService(tenancy);
  const plReportService        = new PLReportService(tenancy);
  const trialBalanceService    = new TrialBalanceService(tenancy, snapshotService);
  const balanceSheetService    = new BalanceSheetService(tenancy, snapshotService, plReportService);
  const periodManagementService = new PeriodManagementService(tenancy, snapshotService);

  return {
    prisma,
    journalRepo,
    sequenceRepo,
    accountRepo,
    postingService,
    openingBalanceService,
    reconciliationService,
    manualJournalService,
    clientInvoiceRepo,
    receiptRepo,
    clientInvoiceService,
    customerReceiptService,
    supplierBillRepo,
    supplierPaymentRepo,
    supplierBillService,
    supplierPaymentService,
    // Phase 3
    snapshotService,
    ledgerService,
    trialBalanceService,
    plReportService,
    balanceSheetService,
    periodManagementService,
  };
}
