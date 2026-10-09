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
import { QuotationListService } from '../../application/quotation-list.service.js';
import { NotificationWriter } from '../../../../../platform/notifications/application/notification-writer.service.js';
import { PurchaseOrderAttachmentRepository } from '../../../purchase-orders/infrastructure/purchase-order-attachment.repository.js';
import { PurchaseOrderService } from '../../../purchase-orders/application/purchase-order.service.js';
import type { SettlementQueryService } from '../../../purchase-orders/application/settlement-query.service.js';
import { CommitmentLedgerRepository } from '../../../commitment-ledger/infrastructure/commitment-ledger.repository.js';
import { CommitmentLedgerWriter } from '../../../commitment-ledger/application/commitment-ledger-writer.service.js';
import { ApprovalService } from '../../../../../platform/workflows/application/approval.service.js';
import type { WorkflowsService } from '../../../../../platform/workflows/application/workflows.service.js';
import { CommunicationService } from '../../../../../platform/messaging/communication.service.js';
import { OutboundMessageRepository } from '../../../../../platform/messaging/infrastructure/outbound-message.repository.js';
import { QuotationWhatsAppAlerts } from '../../application/quotation-whatsapp-alerts.service.js';
import { QuotationSlaAlertJob } from '../../application/quotation-sla-alert.job.js';
import { QuotationAlertGuard } from '../../application/quotation-alert-guard.service.js';
import { QuotationPaymentNotifier } from '../../application/quotation-payment-notifier.service.js';
import { QuotationPaymentReadModel } from '../../application/quotation-payment-read-model.service.js';
import { QuotationPaymentPathService } from '../../application/quotation-payment-path.service.js';
import { SettlementQueryService as RealSettlementQueryService } from '../../../purchase-orders/application/settlement-query.service.js';
import { SettlementQueryRepository } from '../../../purchase-orders/infrastructure/settlement-query.repository.js';

export interface QuotationServiceOptions {
  /** Server environment seen by the WhatsApp alerts (e.g. QUOTATION_WHATSAPP_ENABLED). */
  env?: Record<string, string | undefined>;
  /** Whether the (fake) WhatsApp client reports itself configured. Default true. */
  whatsappConfigured?: boolean;
  /** The fake WhatsApp client's sendTemplate (default: accepts with a fresh wamid). */
  sendTemplate?: (...args: unknown[]) => Promise<{ providerMessageId: string }>;
}

export function buildQuotationServices(prisma: PrismaClient, options: QuotationServiceOptions = {}) {
  const tenancy = { getClient: () => prisma } as unknown as TenancyService;
  const audit = new TransactionalAuditOutboxService();
  const sod = new SegregationOfDutiesService(tenancy);
  const projectAccess = new ProjectAccessService(tenancy);
  const workflowsRepo = new WorkflowsPrismaRepository(tenancy);
  const commandGovernance = new CommandGovernanceService(new WorkflowTriggerResolverService(tenancy), workflowsRepo);

  const repo = new QuotationRequestRepository();
  const poRepo = new PurchaseOrderRepository();
  const access = new QuotationAccessService(sod, projectAccess);
  // ADR-044 phase 2 — real queue + dispatcher over a fake WhatsApp client and a no-op route table.
  const env = options.env ?? {};
  const config = { get: (key: string) => env[key] } as never;
  let wamid = 0;
  const whatsappClient = {
    isConfigured: () => options.whatsappConfigured ?? true,
    uploadMedia: async () => 'MEDIA',
    sendTemplate: options.sendTemplate ?? (async () => ({ providerMessageId: `wamid.qt.${Date.now()}.${++wamid}` })),
  };
  const messages = new OutboundMessageRepository();
  const communication = new CommunicationService(
    tenancy,
    messages,
    { record: async () => undefined } as never,
    whatsappClient as never,
    audit,
  );
  const alerts = new QuotationWhatsAppAlerts(config, communication, messages);
  const runner = new QuotationCommandRunner(tenancy, repo, access, audit);
  // ADR-045 §6 — the payment block on the detail reads the real settlement.
  const paymentReadModel = new QuotationPaymentReadModel(
    tenancy,
    repo,
    access,
    commandGovernance,
    new RealSettlementQueryService(tenancy, new SettlementQueryRepository(), projectAccess),
  );
  const query = new QuotationQueryService(tenancy, repo, access, commandGovernance, alerts, paymentReadModel);
  // approve() never touches WorkflowsService (only initiate() does).
  const approvals = new ApprovalService(workflowsRepo, {} as WorkflowsService, sod);
  const notifier = new QuotationNotifier(new NotificationWriter(), access, sod, projectAccess, alerts);
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
  const collect = new QuotationCollectService(tenancy, repo, poRepo, access, runner, query, audit, commandGovernance, notifier, poService);
  const link = new QuotationMaterialRequestLink(repo, runner, collect);
  const selection = new QuotationSelectionService(runner, query, notifier);
  const awards = new QuotationAwardService(tenancy, repo, access, runner, query, audit, commandGovernance, approvals, sod, notifier);
  const orders = new QuotationOrderService(tenancy, repo, poRepo, poService, access, runner, query, notifier);
  const lists = new QuotationListService(tenancy, projectAccess, commandGovernance, access, query);

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
  // ADR-045 — payment notifications; registers PAYMENT_NEEDED on this PO service's covered confirm.
  const paymentNotifier = new QuotationPaymentNotifier(new NotificationWriter(), access, projectAccess, alerts, repo, poService);
  paymentNotifier.onModuleInit();
  new QuotationAlertGuard(communication, alerts, repo, notifier, paymentNotifier).onModuleInit();
  const paymentPath = new QuotationPaymentPathService(tenancy, repo, access, audit, paymentNotifier, paymentReadModel, query);
  const slaJob = new QuotationSlaAlertJob({} as never, tenancy, repo, notifier, alerts);

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
    lists,
    link,
    mrService,
    fileAuth,
    communication,
    alerts,
    slaJob,
    whatsappClient,
    paymentNotifier,
    paymentReadModel,
    paymentPath,
  };
}

export type QuotationServices = ReturnType<typeof buildQuotationServices>;
