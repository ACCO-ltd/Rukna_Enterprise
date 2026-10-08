import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module.js';
import { NotificationsModule } from '../../../platform/notifications/notifications.module.js';
import { CommunicationModule } from '../../../platform/messaging/communication.module.js';
import { QuotationWhatsAppAlerts } from './application/quotation-whatsapp-alerts.service.js';
import { QuotationSlaAlertJob } from './application/quotation-sla-alert.job.js';
import { QuotationAlertGuard } from './application/quotation-alert-guard.service.js';
import { QuotationNotifier } from './application/quotation-notifier.service.js';
import { QuotationRequestRepository } from './infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './application/quotation-access.service.js';
import { QuotationCommandRunner } from './application/quotation-command-runner.service.js';
import { QuotationQueryService } from './application/quotation-query.service.js';
import { QuotationCollectService } from './application/quotation-collect.service.js';
import { QuotationSelectionService } from './application/quotation-selection.service.js';
import { QuotationAwardService } from './application/quotation-award.service.js';
import { QuotationOrderService } from './application/quotation-order.service.js';
import { QuotationListService } from './application/quotation-list.service.js';
import { QuotationMaterialRequestLink } from './application/quotation-material-request-link.service.js';
import { QuotationRequestController } from './presentation/quotation-request.controller.js';
import { QuotationPaymentNotifier } from './application/quotation-payment-notifier.service.js';
import { AWARD_PAYMENT_EVENTS } from '../../accounting/accounts-payable/domain/award-payment-events.port.js';

/**
 * ADR-044 — competitive quotations between an approved material request and its purchase order.
 * Depends on purchase orders (raise the order, live allocations), never on the material-request
 * module: the MR module imports this one for the cancel cascade and the detail summary.
 */
@Module({
  imports: [TenancyModule, AuditLogsModule, WorkflowsModule, PurchaseOrdersModule, NotificationsModule, CommunicationModule],
  controllers: [QuotationRequestController],
  providers: [
    QuotationRequestRepository,
    QuotationAccessService,
    QuotationCommandRunner,
    QuotationQueryService,
    QuotationNotifier,
    QuotationCollectService,
    QuotationSelectionService,
    QuotationAwardService,
    QuotationOrderService,
    QuotationListService,
    QuotationMaterialRequestLink,
    // ADR-044 phase 2 — WhatsApp alerts to staff (queued) + the 2 h / 4 h SLA chaser (cron).
    QuotationWhatsAppAlerts,
    QuotationSlaAlertJob,
    QuotationAlertGuard,
    // ADR-045 — paying from the award: notifications + the AP events port.
    QuotationPaymentNotifier,
    { provide: AWARD_PAYMENT_EVENTS, useExisting: QuotationPaymentNotifier },
  ],
  exports: [QuotationMaterialRequestLink, QuotationPaymentNotifier, AWARD_PAYMENT_EVENTS, QuotationRequestRepository, QuotationAccessService],
})
export class QuotationsModule {}
