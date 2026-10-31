import { BadRequestException, Injectable, ConflictException, NotFoundException, Optional } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import type {
  AccountClass,
  AccountSubtype,
  NormalBalance,
  ControlPostingPolicy,
  SubledgerType,
} from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AccountRepository, type AccountWithCurrentVersion } from '../infrastructure/account.repository.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import {
  accountFieldsProblem,
  deactivateProblem,
  isHeading,
  parentProblem,
  postingSwitchProblem,
  type AccountProblem,
} from '../domain/account-rules.js';
import { parseDateOnly } from '../domain/calendar-day.js';

const refuse = (problem: AccountProblem | null) => {
  if (problem) throw new BadRequestException(problem);
};

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
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  async create(identity: RequestIdentity, dto: CreateAccountDto) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    // GL-C — a code a person can read, a name, a subtype of the class, a real start date.
    refuse(accountFieldsProblem(dto));
    const code = dto.code.trim();
    const existing = await this.repo.findByCodeInsensitive(prisma, orgId, code);
    if (existing) {
      throw new ConflictException({ errorCode: 'ACCOUNT_CODE_TAKEN', field: 'code', message: `Account ${existing.code} already exists.` });
    }

    let parentAccountId: string | undefined;
    if (dto.parentAccountCode?.trim()) {
      const parent = await this.parentFacts(prisma, orgId, dto.parentAccountCode.trim());
      refuse(parentProblem({ accountClass: dto.accountClass }, parent, dto.parentAccountCode.trim()));
      parentAccountId = parent!.id;
    }

    return this.repo.create(prisma, {
      organizationId: orgId,
      code,
      normalBalance: dto.normalBalance,
      createdBy: userId,
      version: {
        versionNumber: 1,
        name: dto.name.trim(),
        parentAccountId,
        accountClass: dto.accountClass,
        accountSubtype: dto.accountSubtype,
        isPostingAllowed: dto.isPostingAllowed,
        isControlAccount: dto.isControlAccount,
        controlledSubledgerType: dto.controlledSubledgerType,
        controlPostingPolicy: dto.controlPostingPolicy,
        effectiveFrom: parseDateOnly(dto.effectiveFrom)!,
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

    if (dto.name !== undefined) refuse(accountFieldsProblem({ name: dto.name }));

    let parentAccountId: string | undefined = current.parentAccountId ?? undefined;
    if (dto.parentAccountCode !== undefined) {
      if (!dto.parentAccountCode?.trim()) {
        parentAccountId = undefined; // detach
      } else {
        const code = dto.parentAccountCode.trim();
        const parent = await this.parentFacts(prisma, orgId, code);
        // GL-C — a heading of the same class, active, and not this account or one under it.
        refuse(parentProblem({ id, accountClass: current.accountClass }, parent, code));
        parentAccountId = parent!.id;
      }
    }

    const name = dto.name?.trim() ?? current.name;
    const isPostingAllowed = dto.isPostingAllowed ?? current.isPostingAllowed;
    // GL-C — only the posting switch on an ordinary account or heading: control and system-only
    // accounts keep the flags the system relies on.
    if (isPostingAllowed !== current.isPostingAllowed) {
      if (current.isControlAccount || current.controlPostingPolicy === 'SYSTEM_ONLY') {
        throw new BadRequestException({ errorCode: 'ACCOUNT_SYSTEM_KEPT', message: 'The system posts to this account; whether it takes entries is fixed.' });
      }
      const usage = await this.repo.usage(prisma, orgId, id);
      refuse(postingSwitchProblem(isPostingAllowed, usage));
    }

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

  /**
   * GL-C — make an account inactive (it takes no new entries and leaves the pickers) or active
   * again. Inactive only when it holds nothing and nothing still posts to it.
   */
  async setStatus(identity: RequestIdentity, id: string, status: 'ACTIVE' | 'INACTIVE') {
    const prisma = this.tenancyService.getClient();
    const orgId = identity.activeOrganizationId;
    const account = await this.repo.findById(prisma, orgId, id);
    if (!account) throw new NotFoundException({ errorCode: 'ACCOUNT_NOT_FOUND', message: 'This account does not exist.' });
    if (account.status === status) return account;
    const current = account.versions[0];
    if (status === 'INACTIVE') {
      if (current && (current.isControlAccount || current.controlPostingPolicy === 'SYSTEM_ONLY')) {
        throw new BadRequestException({ errorCode: 'ACCOUNT_SYSTEM_KEPT', message: 'The system posts to this account; it stays active.' });
      }
      refuse(deactivateProblem(await this.repo.usage(prisma, orgId, id)));
    } else if (current?.parentAccountId) {
      const parent = await this.repo.findById(prisma, orgId, current.parentAccountId);
      if (parent && parent.status !== 'ACTIVE') {
        throw new BadRequestException({ errorCode: 'PARENT_INACTIVE', message: `Its heading ${parent.code} is inactive; reactivate that first.` });
      }
    }
    return prisma.$transaction(async (tx) => {
      const moved = await tx.account.updateMany({ where: { id, organizationId: orgId, status: account.status }, data: { status } });
      if (moved.count !== 1) throw new ConflictException({ errorCode: 'ACCOUNT_CHANGED', message: 'The account changed meanwhile; reload and try again.' });
      await this.auditOutbox?.record(tx as never, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'Account',
        resourceId: id,
        sourceCommand: status === 'INACTIVE' ? 'account.deactivate' : 'account.reactivate',
        eventType: status === 'INACTIVE' ? 'ACCOUNT_DEACTIVATED' : 'ACCOUNT_REACTIVATED',
        idempotencyKey: `ACCOUNT_STATUS:${id}:${status}:${Date.now()}`,
        before: { status: account.status },
        after: { status, code: account.code },
      });
      return this.repo.findById(tx as never, orgId, id);
    });
  }

  /** A would-be parent, with the accounts above it (to refuse a loop). */
  private async parentFacts(prisma: ReturnType<TenancyService['getClient']>, orgId: string, code: string) {
    const parent: AccountWithCurrentVersion | null = await this.repo.findByCode(prisma, orgId, code);
    const v = parent?.versions[0];
    if (!parent || !v) return null;
    return {
      id: parent.id,
      code: parent.code,
      name: v.name,
      accountClass: v.accountClass,
      heading: isHeading(v),
      active: parent.status === 'ACTIVE',
      lineage: await this.repo.lineage(prisma, orgId, parent.id),
    };
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
          // GL-C — the same rules as adding one account by hand.
          const problem = accountFieldsProblem(row);
          if (problem) throw new Error(problem.message);
          let parentAccountId: string | undefined;
          if (row.parentAccountCode) {
            const parent = await this.parentFacts(prisma, orgId, row.parentAccountCode);
            if (!parent) throw new Error(`Parent account ${row.parentAccountCode} not found — import parent first`);
            const parentIssue = parentProblem({ accountClass: row.accountClass }, parent, row.parentAccountCode);
            if (parentIssue) throw new Error(parentIssue.message);
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
              effectiveFrom: parseDateOnly(row.effectiveFrom) ?? new Date(row.effectiveFrom),
              changedBy: userId,
            },
          });
          result.created++;
        } else {
          const currentVersion = existing.versions[0];
          const nameChanged = currentVersion?.name !== row.name;

          if (!nameChanged || !currentVersion) {
            result.skipped++;
          } else {
            // GL-C — an import renames an existing account and nothing else: its class, subtype
            // and posting flags carry its history, and changing them is an edit with its own checks.
            // `update` closes the current version first, as the non-overlap constraint requires.
            await this.update(identity, existing.id, { name: row.name, changeReason: 'COA import update' });
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
