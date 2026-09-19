import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BuyerAdvanceRepository } from '../infrastructure/buyer-advance.repository.js';
import { PurchaseOrderService } from '../../../procurement/purchase-orders/application/purchase-order.service.js';

export interface CreateBuyerAdvanceCommand {
  purchaseOrderId: string;
  recipientUserId: string;
  amount: number;
  currencyCode: string;
  paymentMethod: string;
  disbursementBankAccountId: string;
  reference?: string;
  notes?: string;
  advancedAt: string;
}

export interface CreateAdvanceReturnCommand {
  amount: number;
  returnMethod: string;
  destinationBankAccountId?: string;
  receivedBy: string;
  receivedAt: string;
  reference?: string;
  note?: string;
}

export interface CreateEvidenceAllocationCommand {
  supplierBillId: string;
  allocatedAmount: number;
}

@Injectable()
export class BuyerAdvanceService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly advanceRepo: BuyerAdvanceRepository,
    private readonly purchaseOrderService: PurchaseOrderService,
  ) {}

  async create(identity: RequestIdentity, cmd: CreateBuyerAdvanceCommand) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: cmd.purchaseOrderId, organizationId: orgId },
      select: { id: true },
    });
    if (!po) {
      throw new NotFoundException(`PurchaseOrder ${cmd.purchaseOrderId} not found in this organization`);
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id: cmd.disbursementBankAccountId, organizationId: orgId },
      select: { id: true },
    });
    if (!bankAccount) {
      throw new NotFoundException(`BankAccount ${cmd.disbursementBankAccountId} not found in this organization`);
    }

    return this.advanceRepo.create(prisma, {
      organizationId: orgId,
      purchaseOrderId: cmd.purchaseOrderId,
      recipientUserId: cmd.recipientUserId,
      amount: new Decimal(cmd.amount),
      currencyCode: cmd.currencyCode,
      paymentMethod: cmd.paymentMethod,
      disbursementBankAccountId: cmd.disbursementBankAccountId,
      reference: cmd.reference,
      notes: cmd.notes,
      advancedAt: new Date(cmd.advancedAt),
      createdBy: userId,
    });
  }

  async createReturn(identity: RequestIdentity, advanceId: string, cmd: CreateAdvanceReturnCommand) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const advance = await this.advanceRepo.findById(prisma, orgId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);

    // Invariant: destinationBankAccountId required when returnMethod is BANK or MOBILE_MONEY
    if (
      (cmd.returnMethod === 'BANK' || cmd.returnMethod === 'MOBILE_MONEY') &&
      !cmd.destinationBankAccountId
    ) {
      throw new BadRequestException(
        `destinationBankAccountId is required when returnMethod is ${cmd.returnMethod}`,
      );
    }

    if (cmd.destinationBankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: { id: cmd.destinationBankAccountId, organizationId: orgId },
        select: { id: true },
      });
      if (!bankAccount) {
        throw new NotFoundException(`BankAccount ${cmd.destinationBankAccountId} not found in this organization`);
      }
    }

    const result = await this.advanceRepo.createReturn(prisma, {
      organizationId: orgId,
      buyerAdvanceId: advanceId,
      amount: new Decimal(cmd.amount),
      returnMethod: cmd.returnMethod,
      destinationBankAccountId: cmd.destinationBankAccountId,
      receivedBy: cmd.receivedBy,
      receivedAt: new Date(cmd.receivedAt),
      reference: cmd.reference,
      note: cmd.note,
    });
    await this.purchaseOrderService.autoCloseIfSettled(identity, advance.purchaseOrderId);
    return result;
  }

  async createEvidenceAllocation(
    identity: RequestIdentity,
    advanceId: string,
    cmd: CreateEvidenceAllocationCommand,
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const advance = await this.advanceRepo.findById(prisma, orgId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);

    const bill = await prisma.supplierBill.findFirst({
      where: { id: cmd.supplierBillId, organizationId: orgId },
      select: { id: true },
    });
    if (!bill) {
      throw new NotFoundException(`SupplierBill ${cmd.supplierBillId} not found in this organization`);
    }

    const result = await this.advanceRepo.createEvidenceAllocation(prisma, {
      organizationId: orgId,
      buyerAdvanceId: advanceId,
      supplierBillId: cmd.supplierBillId,
      allocatedAmount: new Decimal(cmd.allocatedAmount),
      createdBy: userId,
    });
    await this.purchaseOrderService.autoCloseIfSettled(identity, advance.purchaseOrderId);
    return result;
  }

  async findById(identity: RequestIdentity, advanceId: string) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const advance = await this.advanceRepo.findById(prisma, orgId, advanceId);
    if (!advance) throw new NotFoundException(`BuyerAdvance ${advanceId} not found`);

    const evidenceTotal = advance.evidenceAllocations.reduce(
      (sum, ea) => sum.plus(ea.allocatedAmount as unknown as Decimal),
      new Decimal(0),
    );
    const returnsTotal = advance.returns.reduce(
      (sum, r) => sum.plus(r.amount as unknown as Decimal),
      new Decimal(0),
    );
    const outstanding = (advance.amount as unknown as Decimal)
      .minus(evidenceTotal)
      .minus(returnsTotal);

    return { ...advance, outstanding };
  }

  async findByPurchaseOrder(identity: RequestIdentity, purchaseOrderId: string) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const advances = await this.advanceRepo.findByPurchaseOrder(prisma, orgId, purchaseOrderId);

    return advances.map((advance) => {
      const evidenceTotal = advance.evidenceAllocations.reduce(
        (sum, ea) => sum.plus(ea.allocatedAmount as unknown as Decimal),
        new Decimal(0),
      );
      const returnsTotal = advance.returns.reduce(
        (sum, r) => sum.plus(r.amount as unknown as Decimal),
        new Decimal(0),
      );
      const outstanding = (advance.amount as unknown as Decimal)
        .minus(evidenceTotal)
        .minus(returnsTotal);
      return { ...advance, outstanding };
    });
  }
}
