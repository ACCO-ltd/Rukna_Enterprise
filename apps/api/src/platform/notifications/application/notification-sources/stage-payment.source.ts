import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { NotificationKind } from '@erp/types';

import { dedupeKey } from '../../domain/dedupe-key.js';
import {
  deriveInstallmentDueAttention,
  utcCalendarDaysUntil,
} from '../../domain/installment-due-attention.policy.js';
import { deriveNotificationSeverity } from '../../domain/notification-severity.policy.js';
import type { UpsertNotificationData } from '../../domain/notification-repository.interface.js';
import type { NotificationSource } from './notification-source.js';

export const STAGE_PAYMENT_RESOURCE_TYPE = 'ContractPaymentInstallment';

/**
 * One un-invoiced, due-or-overdue milestone stage on an ACTIVE MILESTONE contract. Carries everything
 * the row needs so `toRow` is a pure mapping (no second read per recipient).
 */
export interface StagePaymentCondition {
  resourceId: string;
  projectId: string | null;
  contractId: string;
  kind: Extract<NotificationKind, 'STAGE_PAYMENT_DUE' | 'STAGE_PAYMENT_OVERDUE'>;
  stageName: string;
  contractNumber: string;
  /** Whole days to (or since) the due date — the absolute value is shown to the user. */
  daysToDue: number;
  actionUrl: string;
}

/**
 * ADR-031 — stage-payment (milestone) source. Reads the payment installments that are due soon or
 * overdue and un-invoiced on live MILESTONE contracts, and maps each to a DUE / OVERDUE notification.
 *
 * "Live" for auto-resolve = still un-invoiced (`clientInvoice IS NULL`) on an ACTIVE contract. Once the
 * stage is billed, its `clientInvoice` becomes non-null → it drops out of `findLiveConditions` → the
 * generator's auto-resolve pass closes any open row for it.
 */
@Injectable()
export class StagePaymentSource implements NotificationSource<StagePaymentCondition> {
  readonly resourceType = STAGE_PAYMENT_RESOURCE_TYPE;

  async findLiveConditions(
    prisma: PrismaClient,
    organizationId: string,
    now: Date,
  ): Promise<StagePaymentCondition[]> {
    const installments = await prisma.contractPaymentInstallment.findMany({
      where: {
        dueDate: { not: null },
        clientInvoice: null,
        contract: {
          organizationId,
          status: 'ACTIVE',
          billingModel: 'MILESTONE',
        },
      },
      select: {
        id: true,
        name: true,
        dueDate: true,
        contract: {
          select: { id: true, projectId: true, contractNumber: true },
        },
      },
    });

    const conditions: StagePaymentCondition[] = [];
    for (const installment of installments) {
      if (!installment.dueDate) continue;
      const attention = deriveInstallmentDueAttention(installment.dueDate, now);
      if (attention === 'NONE') continue;

      const kind: StagePaymentCondition['kind'] =
        attention === 'OVERDUE' ? 'STAGE_PAYMENT_OVERDUE' : 'STAGE_PAYMENT_DUE';
      const daysToDue = utcCalendarDaysUntil(installment.dueDate, now);

      conditions.push({
        resourceId: installment.id,
        projectId: installment.contract.projectId,
        contractId: installment.contract.id,
        kind,
        stageName: installment.name,
        contractNumber: installment.contract.contractNumber,
        daysToDue,
        actionUrl: `/projects/${installment.contract.projectId}/commercial/payment-schedule`,
      });
    }
    return conditions;
  }

  toDedupeKey(condition: StagePaymentCondition): string {
    return condition.kind === 'STAGE_PAYMENT_OVERDUE'
      ? dedupeKey.stageOverdue(condition.resourceId)
      : dedupeKey.stageDue(condition.resourceId);
  }

  toRow(
    condition: StagePaymentCondition,
    recipientUserId: string,
    organizationId: string,
  ): UpsertNotificationData {
    const key = this.toDedupeKey(condition);

    return {
      organizationId,
      recipientUserId,
      kind: condition.kind,
      severity: deriveNotificationSeverity(condition.kind),
      dedupeKey: key,
      projectId: condition.projectId,
      contractId: condition.contractId,
      resourceType: this.resourceType,
      resourceId: condition.resourceId,
      contextData: {
        stageName: condition.stageName,
        contractNumber: condition.contractNumber,
        dueInDays: Math.abs(condition.daysToDue),
      },
      actionUrl: condition.actionUrl,
    };
  }
}
