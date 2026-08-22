import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BankAccountRepository } from '../infrastructure/bank-account.repository.js';
import { BankAccountSignatoryRepository } from '../infrastructure/bank-account-signatory.repository.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * ADR-022 CONST-DOA-005 — manages bank-account signatories and answers the two questions the
 * payment-release control asks: does this account need dual control, and is this user allowed to
 * sign for it? Payments from an account with ≥1 active signatory require ≥2 distinct signatures.
 */
@Injectable()
export class BankAccountSignatoryService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: BankAccountSignatoryRepository,
    private readonly bankRepo: BankAccountRepository,
  ) {}

  async add(identity: RequestIdentity, bankAccountId: string, userId: string) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    await this.requireBankAccount(prisma, orgId, bankAccountId);

    const user = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId } });
    if (!user) throw new NotFoundException(`User ${userId} not found in this organization`);

    const existing = await this.repo.findActive(prisma, bankAccountId, userId);
    if (existing) throw new ConflictException('User is already an active signatory of this account');

    return this.repo.add(prisma, { organizationId: orgId, bankAccountId, userId, addedBy: identity.userId });
  }

  async list(identity: RequestIdentity, bankAccountId: string) {
    const prisma = this.tenancyService.getClient();
    await this.requireBankAccount(prisma, identity.activeOrganizationId, bankAccountId);
    return this.repo.listActive(prisma, bankAccountId);
  }

  async remove(identity: RequestIdentity, bankAccountId: string, userId: string) {
    const prisma = this.tenancyService.getClient();
    await this.requireBankAccount(prisma, identity.activeOrganizationId, bankAccountId);
    const result = await this.repo.deactivate(prisma, bankAccountId, userId);
    if (result.count === 0) throw new NotFoundException('User is not an active signatory of this account');
  }

  /** True when the account is under release dual-control (has any active signatory). */
  async requiresDualControl(prisma: TenantPrisma, bankAccountId: string): Promise<boolean> {
    return (await this.repo.countActive(prisma, bankAccountId)) > 0;
  }

  async isActiveSignatory(prisma: TenantPrisma, bankAccountId: string, userId: string): Promise<boolean> {
    return (await this.repo.findActive(prisma, bankAccountId, userId)) !== null;
  }

  private async requireBankAccount(prisma: TenantPrisma, orgId: string, bankAccountId: string) {
    const account = await this.bankRepo.findById(prisma, orgId, bankAccountId);
    if (!account) throw new NotFoundException(`Bank account ${bankAccountId} not found`);
    if (account.allowsPayments === false) {
      throw new BadRequestException('This bank account does not allow payments');
    }
    return account;
  }
}
