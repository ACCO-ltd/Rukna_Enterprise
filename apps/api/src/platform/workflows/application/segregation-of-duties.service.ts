import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenancyService } from '../../tenancy/tenancy.service.js';

export type SodAction =
  | 'APPROVE_MATERIAL_REQUEST'
  | 'RECEIVE_GOODS'
  | 'APPROVE_SUPPLIER_BILL'
  | 'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT'
  | 'CREATE_PURCHASE_ORDER'
  | 'PROCESS_SUPPLIER_PAYMENT'
  | 'APPROVE_MANUAL_JOURNAL'
  | 'APPROVE_BUSINESS_TRANSACTION';

export interface SodEvaluationContext {
  organizationId: string;
  action: SodAction;
  actorUserId: string;
  requesterUserId?: string;
  purchaseOrderCreatorUserId?: string;
  goodsReceiverUserId?: string;
  supplierBillApproverUserId?: string;
  vendorMaintainerUserId?: string;
  journalPreparerUserId?: string;
  isSystemAdministrator?: boolean;
  at?: Date;
}

/**
 * Central SoD evaluator. Feature services supply actors from their aggregate;
 * this service owns all policy-code interpretation and never assumes roles.
 */
@Injectable()
export class SegregationOfDutiesService {
  constructor(private readonly tenancyService: TenancyService) {}

  async assertAllowed(context: SodEvaluationContext): Promise<void> {
    const at = context.at ?? new Date();
    const prisma = this.tenancyService.getClient();
    const rules = await prisma.segregationOfDutiesRule.findMany({
      where: {
        organizationId: context.organizationId,
        isActive: true,
        policyVersion: {
          status: 'ACTIVE',
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
      },
      select: { code: true },
    });

    const activeCodes = new Set(rules.map((rule) => rule.code));
    const sameActor = (otherUserId: string | undefined) =>
      Boolean(otherUserId && otherUserId === context.actorUserId);

    if (
      context.action === 'APPROVE_MATERIAL_REQUEST' &&
      activeCodes.has('REQUESTER_CANNOT_APPROVE_OWN_REQUEST') &&
      sameActor(context.requesterUserId)
    ) this.deny('REQUESTER_CANNOT_APPROVE_OWN_REQUEST');

    if (
      context.action === 'RECEIVE_GOODS' &&
      activeCodes.has('PO_CREATOR_CANNOT_RECEIVE_GOODS') &&
      sameActor(context.purchaseOrderCreatorUserId)
    ) this.deny('PO_CREATOR_CANNOT_RECEIVE_GOODS');

    if (
      context.action === 'APPROVE_SUPPLIER_BILL' &&
      activeCodes.has('GOODS_RECEIVER_CANNOT_APPROVE_BILL') &&
      sameActor(context.goodsReceiverUserId)
    ) this.deny('GOODS_RECEIVER_CANNOT_APPROVE_BILL');

    if (
      context.action === 'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT' &&
      activeCodes.has('BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT') &&
      sameActor(context.supplierBillApproverUserId)
    ) this.deny('BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT');

    if (
      ['CREATE_PURCHASE_ORDER', 'PROCESS_SUPPLIER_PAYMENT'].includes(context.action) &&
      activeCodes.has('VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT') &&
      sameActor(context.vendorMaintainerUserId)
    ) this.deny('VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT');

    if (
      context.action === 'APPROVE_MANUAL_JOURNAL' &&
      activeCodes.has('JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL') &&
      sameActor(context.journalPreparerUserId)
    ) this.deny('JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL');

    if (
      context.action === 'APPROVE_BUSINESS_TRANSACTION' &&
      activeCodes.has('SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION') &&
      context.isSystemAdministrator
    ) this.deny('SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION');
  }

  private deny(ruleCode: string): never {
    throw new ForbiddenException(`Segregation-of-duties rule '${ruleCode}' prohibits this action.`);
  }
}
