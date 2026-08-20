import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BankAccountRepository } from '../infrastructure/bank-account.repository.js';
import { AccountRepository } from '../infrastructure/account.repository.js';

export interface ConfigureBankAccountDto {
  accountName: string;
  bankName: string;
  accountNumber: string;
  currencyCode: string;
  glAccountCode: string;
  allowsReceipts: boolean;
  allowsPayments: boolean;
}

@Injectable()
export class BankAccountService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: BankAccountRepository,
    private readonly accountRepo: AccountRepository,
  ) {}

  async configure(identity: RequestIdentity, dto: ConfigureBankAccountDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const glAccount = await this.accountRepo.findByCode(prisma, orgId, dto.glAccountCode);
    if (!glAccount) {
      throw new NotFoundException(`GL account ${dto.glAccountCode} not found — create it in the COA first`);
    }

    const currentVersion = glAccount.versions[0];
    if (!currentVersion || currentVersion.accountSubtype !== 'CASH_AND_BANK') {
      throw new BadRequestException(
        `GL account ${dto.glAccountCode} must have subtype CASH_AND_BANK, got ${currentVersion?.accountSubtype ?? 'none'}`,
      );
    }

    const existing = await this.repo.findByGlAccount(prisma, orgId, glAccount.id);
    if (existing) {
      throw new ConflictException(
        `GL account ${dto.glAccountCode} is already mapped to bank account "${existing.accountName}"`,
      );
    }

    return this.repo.create(prisma, {
      organizationId: orgId,
      accountName: dto.accountName,
      bankName: dto.bankName,
      accountNumber: dto.accountNumber,
      currencyCode: dto.currencyCode,
      glAccountId: glAccount.id,
      allowsReceipts: dto.allowsReceipts,
      allowsPayments: dto.allowsPayments,
      createdBy: userId,
    });
  }

  async findAll(identity: RequestIdentity) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const account = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!account) throw new NotFoundException(`Bank account ${id} not found`);
    return account;
  }
}
