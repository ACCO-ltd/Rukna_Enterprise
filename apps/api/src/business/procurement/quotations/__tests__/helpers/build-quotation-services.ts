/**
 * Real quotation services over a real Prisma client (no Nest DI): real audit outbox, real SoD,
 * real governance — the quotation specs assert on all three.
 */
import type { PrismaClient } from '@prisma/client';

import type { TenancyService } from '../../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { SegregationOfDutiesService } from '../../../../../platform/workflows/application/segregation-of-duties.service.js';
import { CommandGovernanceService } from '../../../../../platform/workflows/application/command-governance.service.js';
import { WorkflowTriggerResolverService } from '../../../../../platform/workflows/application/workflow-trigger-resolver.service.js';
import { WorkflowsPrismaRepository } from '../../../../../platform/workflows/infrastructure/workflows-prisma.repository.js';
import { ProjectAccessService } from '../../../../../platform/project-access/project-access.service.js';
import { FileAuthorizationService } from '../../../../../platform/files/application/file-authorization.service.js';
import { MaterialRequestRepository } from '../../../material-requests/infrastructure/material-request.repository.js';
import { MaterialRequestService } from '../../../material-requests/application/material-request.service.js';
import { MaterialRepository } from '../../../catalogue/infrastructure/material.repository.js';
import { UomRepository } from '../../../catalogue/infrastructure/uom.repository.js';
import { PurchaseOrderRepository } from '../../../purchase-orders/infrastructure/purchase-order.repository.js';
import { QuotationRequestRepository } from '../../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from '../../application/quotation-access.service.js';
import { QuotationCommandRunner } from '../../application/quotation-command-runner.service.js';
import { QuotationQueryService } from '../../application/quotation-query.service.js';
import { QuotationCollectService } from '../../application/quotation-collect.service.js';
import { QuotationMaterialRequestLink } from '../../application/quotation-material-request-link.service.js';
import { QuotationSelectionService } from '../../application/quotation-selection.service.js';
import { QuotationAwardService } from '../../application/quotation-award.service.js';
import { QuotationOrderService } from '../../application/quotation-order.service.js';
import { QuotationNotifier } from '../../application/quotation-notifier.service.js';
import { NotificationWriter } from '../../../../../platform/notifications/application/notification-writer.service.js';
import { PurchaseOrderAttachmentRepository } from '../../../purchase-orders/infrastructure/purchase-order-attachment.repository.js';
import { PurchaseOrderService } from '../../../purchase-orders/application/purchase-order.service.js';
import type { SettlementQueryService } from '../../../purchase-orders/application/settlement-query.service.js';
import { CommitmentLedgerRepository } from '../../../commitment-ledger/infrastructure/commitment-ledger.repository.js';
import { CommitmentLedgerWriter } from '../../../commitment-ledger/application/commitment-ledger-writer.service.js';
import { ApprovalService } from '../../../../../platform/workflows/application/approval.service.js';
import type { WorkflowsService } from '../../../../../platform/workflows/application/workflows.service.js';

export function buildQuotationServices(prisma: PrismaClient) {
  const tenancy = { getClient: () => prisma } as unknown as TenancyService;
  const audit = new TransactionalAuditOutboxService();
  const sod = new SegregationOfDutiesService(tenancy);
  const projectAccess = new ProjectAccessService(tenancy);
  const workflowsRepo = new WorkflowsPrismaRepository(tenancy);
  const commandGovernance = new CommandGovernanceService(new WorkflowTriggerResolverService(tenancy), workflowsRepo);

  const repo = new QuotationRequestRepository();
  const poRepo = new PurchaseOrderRepository();
  const access = new QuotationAccessService(sod, projectAccess);
  const runner = new QuotationCommandRunner(tenancy, repo, access, audit);
  const query = new QuotationQueryService(tenancy, repo, access, commandGovernance);
  // approve() never touches WorkflowsService (only initiate() does).
  const approvals = new ApprovalService(workflowsRepo, {} as WorkflowsService, sod);
  const notifier = new QuotationNotifier(new NotificationWriter(), access, sod);
  const collect = new QuotationCollectService(tenancy, repo, poRepo, access, runner, query, audit, commandGovernance, notifier);
  const link = new QuotationMaterialRequestLink(repo, runner, collect);
  const selection = new QuotationSelectionService(runner, query, notifier);
  const awards = new QuotationAwardService(tenancy, repo, access, runner, query, audit, commandGovernance, approvals, sod, notifier);
  const noOpSettlement = { getSettlement: async () => ({ settlementStatus: 'OPEN' as const }) } as unknown as SettlementQueryService;
  const poService = new PurchaseOrderService(
    tenancy,
    poRepo,
    new PurchaseOrderAttachmentRepository(),
    new MaterialRepository(),
    new UomRepository(),
    new CommitmentLedgerWriter(new CommitmentLedgerRepository()),
    audit,
    commandGovernance,
    sod,
    noOpSettlement,
  );
  const orders = new QuotationOrderService(tenancy, repo, poRepo, poService, access, runner, query, notifier);

  const mrService = new MaterialRequestService(
    tenancy,
    new MaterialRequestRepository(),
    new MaterialRepository(),
    new UomRepository(),
    projectAccess,
    audit,
    sod,
    commandGovernance,
    link,
  );
  const fileAuth = new FileAuthorizationService(tenancy, projectAccess);

  return {
    prisma,
    tenancy,
    audit,
    sod,
    commandGovernance,
    workflowsRepo,
    repo,
    poRepo,
    access,
    runner,
    query,
    collect,
    selection,
    awards,
    approvals,
    poService,
    orders,
    notifier,
    link,
    mrService,
    fileAuth,
  };
}

export type QuotationServices = ReturnType<typeof buildQuotationServices>;
