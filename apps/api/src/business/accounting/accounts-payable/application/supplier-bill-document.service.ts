import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { WorkflowTransactionType, type RequestIdentity, type SupplierBillEligibility } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ApprovalHistoryService } from '../../../../platform/workflows/application/approval-history.service.js';
import type { ApprovalInstanceView } from '../../../../platform/workflows/domain/approval-history.js';
import { RecordActivityService } from '../../../../platform/audit-logs/application/record-activity.service.js';
import type { ActivityEntryView } from '../../../../platform/audit-logs/domain/record-activity.js';
import { loadActorNames } from '../../../../platform/users/application/actor-names.js';
import { SupplierBillRepository } from '../infrastructure/supplier-bill.repository.js';
import { PeriodValidator } from '../../accounting-core/application/validators/period.validator.js';
import { BankAccountSignatoryService } from '../../accounting-core/application/bank-account-signatory.service.js';
import { summarizeBillPayments, supplierBillEligibility } from '../domain/supplier-bill-eligibility.policy.js';

export interface BillApprovalsView {
  /** Approval chains raised for the bill, newest first — empty when no DoA policy applied. */
  instances: ApprovalInstanceView[];
  /** Set when the bill was approved with no chain: who approved it, and when. */
  directApproval: { actor: { id: string; name: string }; at: string } | null;
}

export interface BillActivityEntry extends ActivityEntryView {
  /** Context for the code — the approving role for an approval step. */
  detail?: string;
}

export interface BillPaymentsView {
  /** Posted allocations only — money that has actually left against this bill. */
  paidAmount: string;
  /** Allocated by payments not yet posted; already deducted from the bill's outstanding amount. */
  pendingAmount: string;
  /** Distinct payments with a posted allocation to this bill. */
  paymentCount: number;
  allocations: Array<{
    id: string;
    paymentId: string;
    paymentNumber: string | null;
    paymentDate: string;
    allocatedAmount: string;
    postingStatus: string;
    paymentStatus: string;
  }>;
}

/**
 * Read models for the supplier bill document page (ADR-036): its approval chain, its history
 * and the payments against it. Kept apart from `SupplierBillService` so the command service's
 * dependencies do not grow with every read the page adds.
 *
 * Every method first loads the bill within the caller's organisation, so a bill id from
 * another organisation is a 404 before any related record is read. The controller's
 * `payables:manage` gate is the same one that guards reading the bill.
 */
@Injectable()
export class SupplierBillDocumentService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: SupplierBillRepository,
    private readonly approvalHistory: ApprovalHistoryService,
    private readonly recordActivity: RecordActivityService,
    private readonly signatories: BankAccountSignatoryService,
  ) {}

  private async requireBill(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const bill = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!bill) throw new NotFoundException(`SupplierBill ${id} not found`);
    return bill;
  }

  async approvals(identity: RequestIdentity, id: string): Promise<BillApprovalsView> {
    const bill = await this.requireBill(identity, id);
    const instances = await this.approvalHistory.forTransaction(
      identity.activeOrganizationId,
      WorkflowTransactionType.SUPPLIER_BILL,
      bill.id,
    );
    let directApproval: BillApprovalsView['directApproval'] = null;
    if (instances.length === 0 && bill.approvedBy && bill.approvedAt) {
      const name = await loadActorNames(this.tenancyService.getClient(), [bill.approvedBy]);
      directApproval = {
        actor: { id: bill.approvedBy, name: name(bill.approvedBy) },
        at: bill.approvedAt.toISOString(),
      };
    }
    return { instances, directApproval };
  }

  /**
   * The bill's history, newest first, merged from three sources:
   *
   *  - the audit log for the bill's own id (submit, approve, post, reverse, matching);
   *  - approval decisions, which the audit log files under the approval instance rather than
   *    the bill;
   *  - creation, which the audit log records before the bill has an id — taken from the bill.
   */
  async activity(identity: RequestIdentity, id: string): Promise<BillActivityEntry[]> {
    const bill = await this.requireBill(identity, id);
    const [audited, chains, creatorName] = await Promise.all([
      this.recordActivity.forRecords(identity.activeOrganizationId, [bill.id]),
      this.approvalHistory.forTransaction(
        identity.activeOrganizationId,
        WorkflowTransactionType.SUPPLIER_BILL,
        bill.id,
      ),
      loadActorNames(this.tenancyService.getClient(), [bill.createdBy]),
    ]);

    const decisions: BillActivityEntry[] = chains.flatMap((chain) =>
      chain.steps
        .filter((step) => step.actor && step.actedAt)
        .map((step) => ({
          id: `${chain.id}:${step.stepOrder}`,
          at: step.actedAt!,
          actor: step.actor!,
          code: step.state === 'REJECTED' ? 'approval.reject' : 'approval.approve',
          detail: step.roleRequired,
        })),
    );

    const created: BillActivityEntry = {
      id: `${bill.id}:created`,
      at: bill.createdAt.toISOString(),
      actor: { id: bill.createdBy, name: creatorName(bill.createdBy) },
      code: 'bills.create',
    };

    return [...audited, ...decisions, created].sort((a, b) => b.at.localeCompare(a.at));
  }

  async payments(identity: RequestIdentity, id: string): Promise<BillPaymentsView> {
    const bill = await this.requireBill(identity, id);
    const allocations = await this.repo.findAllocationsForBill(
      this.tenancyService.getClient(),
      identity.activeOrganizationId,
      bill.id,
    );

    const summary = summarizeBillPayments(
      allocations.map((allocation) => ({
        allocatedAmount: allocation.allocatedAmount.toString(),
        postingStatus: allocation.postingStatus,
        paymentId: allocation.supplierPaymentId,
        paymentDate: allocation.payment.paymentDate,
      })),
    );

    return {
      paidAmount: summary.paid.toFixed(2),
      pendingAmount: summary.pending.toFixed(2),
      paymentCount: summary.paidPaymentCount,
      allocations: allocations.map((allocation) => ({
        id: allocation.id,
        paymentId: allocation.supplierPaymentId,
        paymentNumber: allocation.payment.paymentNumber,
        paymentDate: allocation.payment.paymentDate.toISOString().slice(0, 10),
        allocatedAmount: new Decimal(allocation.allocatedAmount.toString()).toFixed(2),
        postingStatus: allocation.postingStatus,
        paymentStatus: allocation.payment.documentStatus,
      })),
    };
  }

  /**
   * "Why can't I pay this?" (ADR-043 Phase 2) — the bill's steps from submission to paid, each
   * with its owner, built by `supplierBillEligibility` from the SAME rules the post / pay / release
   * commands call. Read-only; the period is read without the posting lock.
   */
  async eligibility(identity: RequestIdentity, id: string): Promise<SupplierBillEligibility> {
    const prisma = this.tenancyService.getClient();
    const bill = await this.requireBill(identity, id);
    const [period, allocations] = await Promise.all([
      PeriodValidator.findCovering(prisma, identity.activeOrganizationId, bill.billDate),
      this.repo.findAllocationsForBill(prisma, identity.activeOrganizationId, bill.id),
    ]);
    const bankAccounts = [...new Set(allocations.map((a) => a.payment.bankAccountId))];
    const dual = new Map(
      await Promise.all(
        bankAccounts.map(
          async (bankAccountId) =>
            [bankAccountId, await this.signatories.requiresDualControl(prisma, bankAccountId)] as const,
        ),
      ),
    );
    return supplierBillEligibility({
      bill: {
        id: bill.id,
        documentStatus: bill.documentStatus,
        postingStatus: bill.postingStatus,
        matchStatus: bill.matchStatus,
        purchaseOrderRevisionId: bill.purchaseOrderRevisionId,
        outstandingAmount: bill.outstandingAmount.toString(),
        returnReason: bill.returnReason,
        lastPostingErrorCode: bill.lastPostingErrorCode,
      },
      postingPeriod: period ? { name: period.name, status: period.status } : null,
      allocations: allocations.map((a) => ({
        postingStatus: a.postingStatus,
        payment: {
          documentStatus: a.payment.documentStatus,
          postingStatus: a.payment.postingStatus,
          underDualControl: dual.get(a.payment.bankAccountId) ?? false,
          signatures: a.payment._count.releaseSignatures,
        },
      })),
    });
  }
}
