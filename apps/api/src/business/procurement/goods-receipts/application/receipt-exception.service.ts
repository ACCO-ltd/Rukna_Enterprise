import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ReceiptExceptionRepository } from '../infrastructure/receipt-exception.repository.js';
import { PurchaseOrderRepository } from '../../purchase-orders/infrastructure/purchase-order.repository.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ADR-022 CONST-DOA-004: the CFO signs off the documented exception (consolidated role name).
const CFO_ROLE = 'CFO';

/**
 * ADR-022 CONST-DOA-004 — the one sanctioned exception to PO_CREATOR_CANNOT_RECEIVE_GOODS.
 *
 * A PO creator may receive against their own order only if (a) an independent supervisor verifies
 * receipt and (b) the CFO approves the documented exception. The three parties must be different
 * people (the receiver, the verifying supervisor, the approving CFO). Only an APPROVED exception
 * unblocks the receiver's GRN (see GoodsReceiptService.create).
 */
@Injectable()
export class ReceiptExceptionService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ReceiptExceptionRepository,
    private readonly poRepo: PurchaseOrderRepository,
  ) {}

  /** Request an exception for the PO's creator to receive against it. */
  async request(identity: RequestIdentity, purchaseOrderId: string, reason: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const po = await this.poRepo.findById(prisma, orgId, purchaseOrderId);
    if (!po) throw new NotFoundException(`Purchase order ${purchaseOrderId} not found`);
    return this.repo.create(prisma, {
      organizationId: orgId,
      purchaseOrderId,
      receiverUserId: po.createdBy,
      reason,
      requestedBy: identity.userId,
    });
  }

  /** An independent supervisor verifies the receipt. Must not be the receiver. */
  async verify(identity: RequestIdentity, exceptionId: string) {
    const { prisma, exception } = await this.require(identity, exceptionId, 'PENDING');
    if (exception.receiverUserId === identity.userId) {
      throw new ForbiddenException('An independent supervisor — not the receiver — must verify the receipt');
    }
    return this.repo.updateStatus(prisma, exception.id, {
      status: 'SUPERVISOR_VERIFIED',
      supervisorUserId: identity.userId,
      supervisorVerifiedAt: new Date(),
    });
  }

  /** The CFO approves the documented exception. Must differ from the receiver and the supervisor. */
  async approve(identity: RequestIdentity, exceptionId: string) {
    const { prisma, exception } = await this.require(identity, exceptionId, 'SUPERVISOR_VERIFIED');
    if (!identity.roles.includes(CFO_ROLE)) {
      throw new ForbiddenException('Only the CFO can approve a receipt exception');
    }
    if (exception.receiverUserId === identity.userId) {
      throw new ForbiddenException('The receiver cannot approve their own exception');
    }
    if (exception.supervisorUserId === identity.userId) {
      throw new ForbiddenException('The verifying supervisor cannot also approve the exception');
    }
    return this.repo.updateStatus(prisma, exception.id, {
      status: 'APPROVED',
      cfoUserId: identity.userId,
      cfoApprovedAt: new Date(),
    });
  }

  async reject(identity: RequestIdentity, exceptionId: string, reason: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const exception = await this.repo.findById(prisma, orgId, exceptionId);
    if (!exception) throw new NotFoundException(`Receipt exception ${exceptionId} not found`);
    if (exception.status === 'APPROVED' || exception.status === 'REJECTED') {
      throw new BadRequestException(`Exception is already ${exception.status}`);
    }
    return this.repo.updateStatus(prisma, exceptionId, { status: 'REJECTED', rejectionReason: reason });
  }

  list(identity: RequestIdentity, purchaseOrderId: string) {
    const prisma = this.tenancy.getClient();
    return this.repo.listByPo(prisma, identity.activeOrganizationId, purchaseOrderId);
  }

  /** Read used by GoodsReceiptService: is this receiver cleared to receive against this PO? */
  isReceiptCleared(prisma: TenantPrisma, purchaseOrderId: string, receiverUserId: string) {
    return this.repo.hasApprovedException(prisma, purchaseOrderId, receiverUserId);
  }

  private async require(
    identity: RequestIdentity,
    exceptionId: string,
    expected: 'PENDING' | 'SUPERVISOR_VERIFIED',
  ) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const exception = await this.repo.findById(prisma, orgId, exceptionId);
    if (!exception) throw new NotFoundException(`Receipt exception ${exceptionId} not found`);
    if (exception.status !== expected) {
      throw new BadRequestException(`Exception is ${exception.status}, expected ${expected}`);
    }
    return { prisma, orgId, exception };
  }
}
