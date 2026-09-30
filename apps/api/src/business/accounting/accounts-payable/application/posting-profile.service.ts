import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PostingProfileVersion } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  PostingProfileRepository,
  type PostingProfileWithVersions,
} from '../infrastructure/posting-profile.repository.js';

/** Account classes a posting profile may point at (bill expense lines, revenue). */
export const PROFILE_TARGET_CLASSES: readonly string[] = ['INCOME', 'COST_OF_SALES', 'EXPENSE'];
export const PROFILE_CODE_PATTERN = /^[A-Z0-9_]{1,50}$/;

export interface PostingProfileVersionView extends PostingProfileVersion {
  accountCode: string | null;
  accountName: string | null;
}

export interface PostingProfileView {
  id: string;
  organizationId: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  createdBy: string;
  /** Every version, newest first (versions[0] is the latest, as before). */
  versions: PostingProfileVersionView[];
  /** The account the version in force today points at — "points to 51100 Cement and concrete". */
  currentAccount: { id: string; code: string; name: string; accountClass: string } | null;
}

export interface CreatePostingProfileInput {
  code: string;
  name: string;
  accountCode: string;
  effectiveFrom?: string;
}

export interface RepointPostingProfileInput {
  name?: string;
  accountCode: string;
  effectiveFrom: string;
}

const accountInvalid = (message: string) =>
  new BadRequestException({ errorCode: 'POSTING_PROFILE_ACCOUNT_INVALID', message });
const versionInvalid = (message: string) =>
  new BadRequestException({ errorCode: 'POSTING_PROFILE_VERSION_INVALID', message });

const profileChanged = (code: string) =>
  new ConflictException({
    errorCode: 'POSTING_PROFILE_CHANGED',
    message: `Posting profile ${code} was changed by someone else. Reload and try again.`,
  });

/** An ISO date (or date-time) → that calendar day at UTC midnight, as `@db.Date` stores it. */
export function toDateOnly(iso: string): Date {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw versionInvalid(`"${iso}" is not a valid date`);
  return d;
}

const todayUtc = () => toDateOnly(new Date().toISOString());

/**
 * ADR-040 §4 — posting profiles become manageable: create, re-point (a new effective-dated
 * version; history kept), deactivate/reactivate. A supplier bill line resolves its expense
 * account through the profile version in force on the bill date, so a re-point never changes a
 * document already posted.
 */
@Injectable()
export class PostingProfileService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: PostingProfileRepository,
  ) {}

  async list(identity: RequestIdentity, status?: 'ACTIVE' | 'INACTIVE'): Promise<PostingProfileView[]> {
    const prisma = this.tenancy.getClient();
    const profiles = await this.repo.findAll(prisma, identity.activeOrganizationId, status);
    return this.present(identity.activeOrganizationId, profiles);
  }

  async create(identity: RequestIdentity, input: CreatePostingProfileInput): Promise<PostingProfileView> {
    const prisma = this.tenancy.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const code = input.code.trim();
    const name = input.name.trim();
    if (!PROFILE_CODE_PATTERN.test(code)) {
      throw new BadRequestException({ errorCode: 'POSTING_PROFILE_CODE_INVALID', message: 'Code must be A–Z, 0–9 or _ (max 50)' });
    }
    if (!name) throw new BadRequestException({ errorCode: 'POSTING_PROFILE_NAME_REQUIRED', message: 'Name is required' });

    if (await this.repo.findByCode(prisma, orgId, code)) throw this.codeTaken(code);
    const account = await this.validTarget(orgId, input.accountCode);
    const effectiveFrom = input.effectiveFrom ? toDateOnly(input.effectiveFrom) : todayUtc();

    let id: string;
    try {
      id = await prisma.$transaction(async (tx) => {
        const created = await this.repo.create(tx, { organizationId: orgId, code, name, accountId: account.id, effectiveFrom, createdBy: userId });
        await this.repo.recordAudit(tx, {
          organizationId: orgId, userId, action: 'POSTING_PROFILE_CREATED', resourceId: created.id,
          after: { code, name, accountCode: account.code, effectiveFrom: effectiveFrom.toISOString().slice(0, 10) },
          sourceCommand: 'posting-profile.create',
        });
        return created.id;
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw this.codeTaken(code);
      throw err;
    }
    return this.getView(orgId, id);
  }

  async repoint(identity: RequestIdentity, id: string, input: RepointPostingProfileInput): Promise<PostingProfileView> {
    const prisma = this.tenancy.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const profile = await this.repo.findById(prisma, orgId, id);
    if (!profile) throw new NotFoundException(`Posting profile ${id} not found`);
    const latest = latestVersion(profile);
    if (!latest) throw versionInvalid(`Posting profile ${profile.code} has no version to supersede`);

    const account = await this.validTarget(orgId, input.accountCode);
    const effectiveFrom = toDateOnly(input.effectiveFrom);
    if (effectiveFrom.getTime() <= latest.effectiveFrom.getTime()) {
      throw versionInvalid(
        `The new version must start after the current one (${latest.effectiveFrom.toISOString().slice(0, 10)})`,
      );
    }
    // M1: a re-point may not move a profile between the revenue and the cost/expense families —
    // bill lines already name cost profiles, and revenue must never be debited by a bill.
    const currentClass = (await this.repo.findAccountLabels(prisma, orgId, [latest.accountId])).get(latest.accountId)?.accountClass;
    if (currentClass && classFamily(currentClass) !== classFamily(account.accountClass)) {
      throw new BadRequestException({
        errorCode: 'POSTING_PROFILE_CLASS_CHANGE',
        message:
          `Posting profile ${profile.code} points at a ${currentClass} account; it can only be re-pointed to ` +
          (classFamily(currentClass) === 'REVENUE' ? 'an income account' : 'a cost-of-sales or expense account'),
      });
    }

    const name = input.name?.trim() || latest.name;
    if (account.id === latest.accountId && name === latest.name) {
      throw versionInvalid('Nothing changes: the profile already points at this account under this name');
    }

    try {
      await prisma.$transaction(async (tx) => {
        // L1: serialise concurrent re-points; the loser answers 409 instead of a constraint 500.
        if ((await this.repo.lockAndLatestVersionNumber(tx, profile.id)) !== latest.versionNumber) {
          throw profileChanged(profile.code);
        }
        await this.repo.addVersion(tx, latest, { name, accountId: account.id, effectiveFrom, changedBy: userId });
        await this.repo.recordAudit(tx, {
          organizationId: orgId, userId, action: 'POSTING_PROFILE_REPOINTED', resourceId: profile.id,
          before: { versionNumber: latest.versionNumber, accountId: latest.accountId, name: latest.name },
          after: {
            versionNumber: latest.versionNumber + 1, accountCode: account.code, name,
            effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
          },
          sourceCommand: 'posting-profile.repoint',
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw profileChanged(profile.code);
      throw err;
    }
    return this.getView(orgId, id);
  }

  async setActive(identity: RequestIdentity, id: string, active: boolean): Promise<PostingProfileView> {
    const prisma = this.tenancy.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const profile = await this.repo.findById(prisma, orgId, id);
    if (!profile) throw new NotFoundException(`Posting profile ${id} not found`);
    const target = active ? 'ACTIVE' : 'INACTIVE';
    if (profile.status === target) return this.getView(orgId, id); // idempotent

    // L2: deactivating a profile an unposted bill still names would make that bill unpostable.
    if (!active) {
      const inUse = await this.repo.countUnpostedBillsUsing(prisma, orgId, profile.code);
      if (inUse > 0) {
        throw new ConflictException({
          errorCode: 'POSTING_PROFILE_IN_USE',
          message: `Posting profile ${profile.code} is used by ${inUse} unposted supplier bill(s). Post, re-code or cancel them first.`,
          details: { unpostedBills: inUse },
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await this.repo.setStatus(tx, id, target);
      await this.repo.recordAudit(tx, {
        organizationId: orgId, userId,
        action: active ? 'POSTING_PROFILE_REACTIVATED' : 'POSTING_PROFILE_DEACTIVATED',
        resourceId: id, before: { status: profile.status }, after: { status: target },
        sourceCommand: active ? 'posting-profile.reactivate' : 'posting-profile.deactivate',
      });
    });
    return this.getView(orgId, id);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private codeTaken(code: string) {
    return new ConflictException({ errorCode: 'POSTING_PROFILE_CODE_TAKEN', message: `Posting profile code ${code} is already used` });
  }

  private async validTarget(orgId: string, accountCode: string) {
    const prisma = this.tenancy.getClient();
    const account = await this.repo.findAccountByCode(prisma, orgId, accountCode);
    if (!account) throw accountInvalid(`Account ${accountCode} does not exist`);
    if (account.status !== 'ACTIVE') throw accountInvalid(`Account ${accountCode} is not active`);
    if (!account.isPostingAllowed) throw accountInvalid(`Account ${accountCode} does not accept postings (heading or control account)`);
    if (!PROFILE_TARGET_CLASSES.includes(account.accountClass)) {
      throw accountInvalid(`Account ${accountCode} is ${account.accountClass}; a profile must point at an income, cost-of-sales or expense account`);
    }
    return account;
  }

  private async getView(orgId: string, id: string): Promise<PostingProfileView> {
    const prisma = this.tenancy.getClient();
    const profile = await this.repo.findById(prisma, orgId, id);
    if (!profile) throw new NotFoundException(`Posting profile ${id} not found`);
    const [view] = await this.present(orgId, [profile]);
    return view!;
  }

  private async present(orgId: string, profiles: PostingProfileWithVersions[]): Promise<PostingProfileView[]> {
    const prisma = this.tenancy.getClient();
    const accountIds = [...new Set(profiles.flatMap((p) => p.versions.map((v) => v.accountId)))];
    const labels = await this.repo.findAccountLabels(prisma, orgId, accountIds);
    const today = todayUtc().getTime();

    return profiles.map((p) => {
      const inForce = p.versions.find(
        (v) => v.effectiveFrom.getTime() <= today && (v.effectiveTo === null || today < v.effectiveTo.getTime()),
      );
      const label = inForce ? labels.get(inForce.accountId) : undefined;
      return {
        id: p.id,
        organizationId: p.organizationId,
        code: p.code,
        status: p.status as 'ACTIVE' | 'INACTIVE',
        createdAt: p.createdAt,
        createdBy: p.createdBy,
        versions: p.versions.map((v) => ({
          ...v,
          accountCode: labels.get(v.accountId)?.code ?? null,
          accountName: labels.get(v.accountId)?.name ?? null,
        })),
        currentAccount: inForce && label ? { id: inForce.accountId, ...label } : null,
      };
    });
  }
}

function classFamily(accountClass: string): 'REVENUE' | 'COST' {
  return accountClass === 'INCOME' ? 'REVENUE' : 'COST';
}

function latestVersion(profile: PostingProfileWithVersions): PostingProfileVersion | null {
  if (profile.versions.length === 0) return null;
  return profile.versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
}
