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

export interface UpdateAccountInput {
  name?: string;
  isPostingAllowed?: boolean;
  /** Parent account code; '' or null detaches. Undefined leaves the parent unchanged. */
  parentAccountCode?: string | null;
  changeReason?: string;
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

  /**
   * Edit a GL account (rename / re-parent / toggle posting-allowed) by superseding its current
   * AccountVersion with a new effective-dated one. The prior version's effectiveTo is closed to the
   * new version's effectiveFrom IN THE SAME TRANSACTION — otherwise two open-ended versions would
   * overlap and the account_versions non-overlap exclusion constraint rejects the write. Posted
   * journal lines keep their name snapshot, so history is untouched.
   */
  async update(identity: RequestIdentity, id: string, dto: UpdateAccountInput) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const account = await this.repo.findById(prisma, orgId, id);
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    const current = account.versions[0];
    if (!current) throw new NotFoundException(`Account ${id} has no version to edit`);

    let parentAccountId: string | undefined = current.parentAccountId ?? undefined;
    if (dto.parentAccountCode !== undefined) {
      if (!dto.parentAccountCode) {
        parentAccountId = undefined; // detach
      } else {
        const parent = await this.repo.findByCode(prisma, orgId, dto.parentAccountCode);
        if (!parent) throw new NotFoundException(`Parent account ${dto.parentAccountCode} not found`);
        if (parent.id === id) throw new ConflictException('An account cannot be its own parent');
        parentAccountId = parent.id;
      }
    }

    const name = dto.name ?? current.name;
    const isPostingAllowed = dto.isPostingAllowed ?? current.isPostingAllowed;

    const unchanged =
      name === current.name &&
      isPostingAllowed === current.isPostingAllowed &&
      parentAccountId === (current.parentAccountId ?? undefined);
    if (unchanged) return account;

    // Normally the edit takes effect today. A version that has not started yet (a chart installed
    // for a future fiscal year) cannot be closed today — [future, today) is an invalid range and
    // Postgres rejects it (500). The new version then starts where the current one does, closing
    // the current version to an empty range: the same shape a same-day second edit already
    // produces, and it keeps every version row immutable rather than rewriting one in place.
    const now = new Date();
    const effectiveFrom = current.effectiveFrom.getTime() > now.getTime() ? current.effectiveFrom : now;

    return prisma.$transaction(async (tx) => {
      // Close the current version so the non-overlap exclusion constraint holds.
      await tx.accountVersion.update({
        where: { id: current.id },
        data: { effectiveTo: effectiveFrom },
      });
      await this.repo.addVersion(tx as never, id, {
        versionNumber: current.versionNumber + 1,
        name,
        parentAccountId,
        accountClass: current.accountClass,
        accountSubtype: current.accountSubtype,
        isPostingAllowed,
        isControlAccount: current.isControlAccount,
        controlledSubledgerType: current.controlledSubledgerType ?? undefined,
        controlPostingPolicy: current.controlPostingPolicy,
        effectiveFrom,
        changedBy: userId,
        changeReason: dto.changeReason ?? 'Account edited',
      });
      return this.repo.findById(tx as never, orgId, id);
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
