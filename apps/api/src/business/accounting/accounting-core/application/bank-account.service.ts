import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
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

export interface UpdateBankAccountDto {
  accountName?: string;
  bankName?: string;
  accountNumber?: string;
  allowsReceipts?: boolean;
  allowsPayments?: boolean;
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

  /**
   * B-1 — every account with what the ledger says is in it (`bookBalance`, posted lines on its GL
   * account) and how far it has been checked against the bank (`lastReconciledTo`).
   */
  async findAll(identity: RequestIdentity) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const accounts = await this.repo.findAll(prisma, orgId);
    const [balances, reconciled] = await Promise.all([
      this.repo.bookBalances(prisma, orgId, accounts.map((a) => a.glAccountId)),
      this.repo.lastReconciled(prisma, orgId),
    ]);
    return accounts.map((a) => ({
      ...a,
      bookBalance: (balances.get(a.glAccountId) ?? new Decimal(0)).toFixed(2),
      lastReconciledTo: reconciled.get(a.id)?.toISOString().slice(0, 10) ?? null,
    }));
  }

  /** B-1 — correct the account's details or what it is used for. The GL account never changes. */
  async update(identity: RequestIdentity, id: string, dto: UpdateBankAccountDto) {
    const prisma = this.tenancyService.getClient();
    const account = await this.findById(identity, id);
    if (account.status === 'CLOSED') {
      throw new ConflictException({ errorCode: 'BANK_ACCOUNT_CLOSED', message: 'A closed account cannot be changed.' });
    }
    const data: Parameters<BankAccountRepository['update']>[2] = {};
    for (const field of ['accountName', 'bankName', 'accountNumber'] as const) {
      if (dto[field] !== undefined) {
        const value = dto[field]!.trim();
        if (!value) throw new BadRequestException({ errorCode: 'FIELD_REQUIRED', message: `${field} cannot be empty.`, details: { field } });
        data[field] = value;
      }
    }
    if (dto.allowsReceipts !== undefined) data.allowsReceipts = dto.allowsReceipts;
    if (dto.allowsPayments !== undefined) data.allowsPayments = dto.allowsPayments;
    try {
      return await this.repo.update(prisma, account.id, data);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ errorCode: 'ACCOUNT_NUMBER_TAKEN', message: 'Another bank account already has that number.' });
      }
      throw err;
    }
  }

  /**
   * B-1 — suspend an account (nothing new can be paid from or into it), reactivate it, or close
   * it for good. Closing needs a zero balance in the ledger and nothing raised on it still waiting
   * to post; a closed account stays on record for its history.
   */
  async setStatus(identity: RequestIdentity, id: string, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED') {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const account = await this.findById(identity, id);
    if (account.status === 'CLOSED') {
      throw new ConflictException({ errorCode: 'BANK_ACCOUNT_CLOSED', message: 'A closed account cannot be reopened. Set up a new one.' });
    }
    if (account.status === status) return account;
    if (status === 'CLOSED') {
      const balance = (await this.repo.bookBalances(prisma, orgId, [account.glAccountId])).get(account.glAccountId) ?? new Decimal(0);
      if (!balance.isZero()) {
        throw new ConflictException({
          errorCode: 'BANK_ACCOUNT_HAS_BALANCE',
          message: `The ledger still shows ${balance.toFixed(2)} in this account. Transfer it out before closing.`,
          details: { bookBalance: balance.toFixed(2) },
        });
      }
      const waiting = await this.repo.unpostedDocuments(prisma, orgId, account.id);
      if (waiting > 0) {
        throw new ConflictException({
          errorCode: 'BANK_ACCOUNT_HAS_PENDING',
          message: `${waiting} payment(s) or receipt(s) raised on this account have not posted yet. Post or cancel them first.`,
          details: { pending: waiting },
        });
      }
    }
    return this.repo.setStatus(prisma, account.id, status);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const account = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!account) throw new NotFoundException(`Bank account ${id} not found`);
    return account;
  }
}
