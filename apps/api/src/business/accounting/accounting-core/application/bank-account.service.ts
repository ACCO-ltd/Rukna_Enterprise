import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BankAccountRepository } from '../infrastructure/bank-account.repository.js';
import { AccountRepository } from '../infrastructure/account.repository.js';
import { BANK_ACCOUNT_CURRENCY, bankAccountFieldsProblem } from '../domain/bank-account-rules.js';

export interface ConfigureBankAccountDto {
  accountName: string;
  bankName: string;
  accountNumber: string;
  currencyCode?: string;
  glAccountCode: string;
  kind?: BankAccountKind;
  allowsReceipts: boolean;
  allowsPayments: boolean;
}

/** PM-3 — a bank account, a cash box or a mobile-money wallet; receipts land by payment method. */
export type BankAccountKind = 'BANK' | 'CASH' | 'MOBILE_WALLET';

export interface UpdateBankAccountDto {
  accountName?: string;
  bankName?: string;
  accountNumber?: string;
  kind?: BankAccountKind;
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

  /**
   * BK-1 — a new account over a cash-and-bank GL account that is open for posting and not yet
   * linked to another account. USD only; the account number is unique in the organisation.
   */
  async configure(identity: RequestIdentity, dto: ConfigureBankAccountDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const problem = bankAccountFieldsProblem(dto);
    if (problem) {
      throw new BadRequestException({ errorCode: problem.errorCode, message: problem.message, ...(problem.field ? { field: problem.field, details: { field: problem.field } } : {}) });
    }
    const accountName = dto.accountName.trim();
    const accountNumber = dto.accountNumber.trim();

    const glAccount = await this.accountRepo.findByCode(prisma, orgId, (dto.glAccountCode ?? '').trim());
    if (!glAccount) {
      throw new NotFoundException({ errorCode: 'GL_ACCOUNT_NOT_FOUND', message: `There is no account ${dto.glAccountCode} in the chart of accounts.`, details: { field: 'glAccountCode' } });
    }
    const currentVersion = glAccount.versions[0];
    if (!currentVersion || currentVersion.accountSubtype !== 'CASH_AND_BANK') {
      throw new BadRequestException({ errorCode: 'GL_ACCOUNT_NOT_CASH', message: `${glAccount.code} is not a cash and bank account in the chart.`, details: { field: 'glAccountCode' } });
    }
    if (glAccount.status !== 'ACTIVE' || !currentVersion.isPostingAllowed) {
      throw new BadRequestException({ errorCode: 'GL_ACCOUNT_NOT_POSTABLE', message: `${glAccount.code} ${currentVersion.name} is inactive or a heading, so nothing can post to it.`, details: { field: 'glAccountCode' } });
    }

    const existing = await this.repo.findByGlAccount(prisma, orgId, glAccount.id);
    if (existing) {
      throw new ConflictException({ errorCode: 'GL_ACCOUNT_ALREADY_LINKED', message: `${glAccount.code} is already used by "${existing.accountName}".`, details: { field: 'glAccountCode' } });
    }
    const sameNumber = await this.repo.findByAccountNumber(prisma, orgId, accountNumber);
    if (sameNumber) {
      throw new ConflictException({ errorCode: 'ACCOUNT_NUMBER_TAKEN', message: `"${sameNumber.accountName}" already has account number ${accountNumber}.`, details: { field: 'accountNumber' } });
    }

    try {
      return await this.repo.create(prisma, {
        organizationId: orgId,
        accountName,
        bankName: dto.bankName.trim(),
        accountNumber,
        currencyCode: BANK_ACCOUNT_CURRENCY,
        glAccountId: glAccount.id,
        kind: dto.kind ?? 'BANK',
        allowsReceipts: dto.allowsReceipts,
        allowsPayments: dto.allowsPayments,
        createdBy: userId,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ errorCode: 'ACCOUNT_NUMBER_TAKEN', message: 'Another account already has that number, or uses that ledger account.' });
      }
      throw err;
    }
  }

  /**
   * B-1 — every account with what the ledger says is in it (`bookBalance`, posted lines on its GL
   * account) and how far it has been checked against the bank (`lastReconciledTo`).
   */
  async findAll(identity: RequestIdentity) {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const accounts = await this.repo.findAll(prisma, orgId);
    return this.withFigures(prisma, orgId, accounts);
  }

  /** BK — one account with the same figures as the list: the account page. */
  async view(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const account = await this.findById(identity, id);
    const [withFigures] = await this.withFigures(prisma, identity.activeOrganizationId, [account]);
    return withFigures!;
  }

  /**
   * What the ledger says is in each account (`bookBalance`), how far it has been checked against
   * the bank (`lastReconciledTo`) and what the bank said then (`lastStatementBalance`).
   */
  private async withFigures<T extends { id: string; glAccountId: string }>(prisma: ReturnType<TenancyService['getClient']>, orgId: string, accounts: T[]) {
    const [balances, reconciled, statementBalances] = await Promise.all([
      this.repo.bookBalances(prisma, orgId, accounts.map((a) => a.glAccountId)),
      this.repo.lastReconciled(prisma, orgId),
      this.repo.lastStatementBalances(prisma, orgId),
    ]);
    return accounts.map((a) => ({
      ...a,
      bookBalance: (balances.get(a.glAccountId) ?? new Decimal(0)).toFixed(2),
      lastReconciledTo: reconciled.get(a.id)?.toISOString().slice(0, 10) ?? null,
      lastStatementBalance: statementBalances.get(a.id)?.toFixed(2) ?? null,
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
    if (dto.kind !== undefined) data.kind = dto.kind;
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
          message: `${waiting} payment(s), receipt(s) or transfer(s) on this account have not posted yet. Post, reject or cancel them first.`,
          details: { pending: waiting },
        });
      }
    }
    return this.repo.setStatus(prisma, account.id, status);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const account = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!account) throw new NotFoundException({ errorCode: 'BANK_ACCOUNT_NOT_FOUND', message: `Bank account ${id} not found` });
    return account;
  }
}
