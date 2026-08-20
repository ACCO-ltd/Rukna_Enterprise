import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import type {
  AccountClass,
  AccountSubtype,
  NormalBalance,
  ControlPostingPolicy,
  SubledgerType,
} from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AccountRepository } from '../infrastructure/account.repository.js';

export interface CreateAccountDto {
  code: string;
  name: string;
  accountClass: AccountClass;
  accountSubtype: AccountSubtype;
  normalBalance: NormalBalance;
  isPostingAllowed: boolean;
  isControlAccount: boolean;
  controlledSubledgerType?: SubledgerType;
  controlPostingPolicy: ControlPostingPolicy;
  parentAccountCode?: string;
  effectiveFrom: string; // ISO date
}

export interface ImportCoaRow extends CreateAccountDto {
  // same shape; batch import uses this type
}

export interface ImportCoaResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ code: string; message: string }>;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: AccountRepository,
  ) {}

  async create(identity: RequestIdentity, dto: CreateAccountDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const existing = await this.repo.findByCode(prisma, orgId, dto.code);
    if (existing) throw new ConflictException(`Account code ${dto.code} already exists`);

    let parentAccountId: string | undefined;
    if (dto.parentAccountCode) {
      const parent = await this.repo.findByCode(prisma, orgId, dto.parentAccountCode);
      if (!parent) throw new NotFoundException(`Parent account ${dto.parentAccountCode} not found`);
      parentAccountId = parent.id;
    }

    return this.repo.create(prisma, {
      organizationId: orgId,
      code: dto.code,
      normalBalance: dto.normalBalance,
      createdBy: userId,
      version: {
        versionNumber: 1,
        name: dto.name,
        parentAccountId,
        accountClass: dto.accountClass,
        accountSubtype: dto.accountSubtype,
        isPostingAllowed: dto.isPostingAllowed,
        isControlAccount: dto.isControlAccount,
        controlledSubledgerType: dto.controlledSubledgerType,
        controlPostingPolicy: dto.controlPostingPolicy,
        effectiveFrom: new Date(dto.effectiveFrom),
        changedBy: userId,
      },
    });
  }

  async findAll(identity: RequestIdentity) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const account = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  async findByCode(identity: RequestIdentity, code: string) {
    const prisma = this.tenancyService.getClient();
    const account = await this.repo.findByCode(prisma, identity.activeOrganizationId, code);
    if (!account) throw new NotFoundException(`Account ${code} not found`);
    return account;
  }

  async importChartOfAccounts(
    identity: RequestIdentity,
    rows: ImportCoaRow[],
  ): Promise<ImportCoaResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;
    const result: ImportCoaResult = { created: 0, updated: 0, skipped: 0, errors: [] };

    // Two passes: first create parent accounts, then children
    const sorted = this.sortByHierarchy(rows);

    for (const row of sorted) {
      try {
        const existing = await this.repo.findByCode(prisma, orgId, row.code);

        if (!existing) {
          let parentAccountId: string | undefined;
          if (row.parentAccountCode) {
            const parent = await this.repo.findByCode(prisma, orgId, row.parentAccountCode);
            if (!parent) throw new Error(`Parent account ${row.parentAccountCode} not found — import parent first`);
            parentAccountId = parent.id;
          }

          await this.repo.create(prisma, {
            organizationId: orgId,
            code: row.code,
            normalBalance: row.normalBalance,
            createdBy: userId,
            version: {
              versionNumber: 1,
              name: row.name,
              parentAccountId,
              accountClass: row.accountClass,
              accountSubtype: row.accountSubtype,
              isPostingAllowed: row.isPostingAllowed,
              isControlAccount: row.isControlAccount,
              controlledSubledgerType: row.controlledSubledgerType,
              controlPostingPolicy: row.controlPostingPolicy,
              effectiveFrom: new Date(row.effectiveFrom),
              changedBy: userId,
            },
          });
          result.created++;
        } else {
          const currentVersion = existing.versions[0];
          const nameChanged = currentVersion?.name !== row.name;

          if (!nameChanged) {
            result.skipped++;
          } else {
            await this.repo.addVersion(prisma, existing.id, {
              versionNumber: (currentVersion?.versionNumber ?? 0) + 1,
              name: row.name,
              parentAccountId: currentVersion?.parentAccountId ?? undefined,
              accountClass: row.accountClass,
              accountSubtype: row.accountSubtype,
              isPostingAllowed: row.isPostingAllowed,
              isControlAccount: row.isControlAccount,
              controlledSubledgerType: row.controlledSubledgerType,
              controlPostingPolicy: row.controlPostingPolicy,
              effectiveFrom: new Date(row.effectiveFrom),
              changedBy: userId,
              changeReason: 'COA import update',
            });
            result.updated++;
          }
        }
      } catch (err: unknown) {
        result.errors.push({
          code: row.code,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  // Sort so parents appear before children (no parent = comes first)
  private sortByHierarchy(rows: ImportCoaRow[]): ImportCoaRow[] {
    const withoutParent = rows.filter(r => !r.parentAccountCode);
    const withParent = rows.filter(r => r.parentAccountCode);
    return [...withoutParent, ...withParent];
  }
}
