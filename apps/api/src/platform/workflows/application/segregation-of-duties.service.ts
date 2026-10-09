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
  | 'APPROVE_BUSINESS_TRANSACTION'
  // ADR-044 §6 — entering a quote total, rejecting a quote, asking for another, awarding (and
  // approving an award: the award command evaluates it for every approver on the instance).
  | 'SELECT_QUOTATION'
  // ADR-045 §2 — releasing a buyer (staff) cash advance, and approving its release.
  | 'RELEASE_BUYER_ADVANCE';

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
  /** ADR-044 §6 — the request's creator and every quote/photo uploader, withdrawn quotes included. */
  quoteUploaderUserIds?: string[];
  /** ADR-045 §2 — the employee the cash advance is released to. */
  advanceRecipientUserId?: string;
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
    const activeCodes = await this.activeRuleCodes(context.organizationId, context.at);
    const violated = this.violation(activeCodes, context);
    if (violated) this.deny(violated);
  }

  /** The SoD rule codes in force for the org on `at` (default now). Load once, evaluate many. */
  async activeRuleCodes(organizationId: string, at: Date = new Date()): Promise<Set<string>> {
    const prisma = this.tenancyService.getClient();
    const rules = await prisma.segregationOfDutiesRule.findMany({
      where: {
        organizationId,
        isActive: true,
        policyVersion: {
          status: 'ACTIVE',
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
      },
      select: { code: true },
    });
    return new Set(rules.map((rule) => rule.code));
  }

  /**
   * The rule code `context` would violate under `activeCodes`, or null when it is allowed. Pure —
   * read models (e.g. "can I receive this PO?") use it to answer without throwing.
   */
  violation(activeCodes: Set<string>, context: SodEvaluationContext): string | null {
    const sameActor = (otherUserId: string | undefined) =>
      Boolean(otherUserId && otherUserId === context.actorUserId);

    if (
      context.action === 'APPROVE_MATERIAL_REQUEST' &&
      activeCodes.has('REQUESTER_CANNOT_APPROVE_OWN_REQUEST') &&
      sameActor(context.requesterUserId)
    ) return 'REQUESTER_CANNOT_APPROVE_OWN_REQUEST';

    if (
      context.action === 'RECEIVE_GOODS' &&
      activeCodes.has('PO_CREATOR_CANNOT_RECEIVE_GOODS') &&
      sameActor(context.purchaseOrderCreatorUserId)
    ) return 'PO_CREATOR_CANNOT_RECEIVE_GOODS';

    if (
      context.action === 'APPROVE_SUPPLIER_BILL' &&
      activeCodes.has('GOODS_RECEIVER_CANNOT_APPROVE_BILL') &&
      sameActor(context.goodsReceiverUserId)
    ) return 'GOODS_RECEIVER_CANNOT_APPROVE_BILL';

    if (
      context.action === 'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT' &&
      activeCodes.has('BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT') &&
      sameActor(context.supplierBillApproverUserId)
    ) return 'BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT';

    if (
      ['CREATE_PURCHASE_ORDER', 'PROCESS_SUPPLIER_PAYMENT'].includes(context.action) &&
      activeCodes.has('VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT') &&
      sameActor(context.vendorMaintainerUserId)
    ) return 'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT';

    if (
      context.action === 'APPROVE_MANUAL_JOURNAL' &&
      activeCodes.has('JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL') &&
      sameActor(context.journalPreparerUserId)
    ) return 'JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL';

    if (
      context.action === 'SELECT_QUOTATION' &&
      activeCodes.has('QUOTE_UPLOADER_CANNOT_SELECT') &&
      (context.quoteUploaderUserIds ?? []).includes(context.actorUserId)
    ) return 'QUOTE_UPLOADER_CANNOT_SELECT';

    if (
      context.action === 'SELECT_QUOTATION' &&
      activeCodes.has('REQUESTER_CANNOT_SELECT') &&
      sameActor(context.requesterUserId)
    ) return 'REQUESTER_CANNOT_SELECT';

    if (
      context.action === 'RELEASE_BUYER_ADVANCE' &&
      activeCodes.has('ADVANCE_RECIPIENT_CANNOT_RELEASE') &&
      sameActor(context.advanceRecipientUserId)
    ) return 'ADVANCE_RECIPIENT_CANNOT_RELEASE';

    if (
      context.action === 'APPROVE_BUSINESS_TRANSACTION' &&
      activeCodes.has('SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION') &&
      context.isSystemAdministrator
    ) return 'SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION';

    return null;
  }

  private deny(ruleCode: string): never {
    // details.code carries the rule code machine-readably (GlobalExceptionFilter forwards
    // `details`); the message is unchanged for existing callers.
    throw new ForbiddenException({
      errorCode: 'FORBIDDEN',
      message: `Segregation-of-duties rule '${ruleCode}' prohibits this action.`,
      details: { code: ruleCode },
    });
  }
}
