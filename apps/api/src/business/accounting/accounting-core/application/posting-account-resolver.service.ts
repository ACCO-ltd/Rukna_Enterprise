import { BadRequestException, Injectable } from '@nestjs/common';
import type { AccountSubtype, PrismaClient } from '@prisma/client';

import { AccountRepository } from '../infrastructure/account.repository.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface ResolvedAccount {
  id: string;
  code: string;
}

/**
 * ADR-024 ACC-POST-001 — resolve an AR control/posting account by its role, server-side.
 *
 * Until now AR made the client resolve these (apps/web `posting-accounts.ts`) and pass the codes
 * in the request body. This centralizes it so the server is the single authority, mirroring how
 * AP resolves its per-line accounts. The rule is identical to the one the frontend used: the
 * single ACTIVE account whose CURRENT version carries the subtype. Zero → NOT_CONFIGURED (the
 * chart is incomplete); more than one → AMBIGUOUS (an administrator must resolve which is the
 * control account) — never guess past either, because a wrong control account misposts money.
 */
@Injectable()
export class PostingAccountResolver {
  constructor(private readonly accountRepo: AccountRepository) {}

  async resolve(
    prisma: TenantPrisma,
    organizationId: string,
    subtype: AccountSubtype,
  ): Promise<ResolvedAccount> {
    const accounts = await this.accountRepo.findAll(prisma, organizationId);
    const matches = accounts.filter(
      (account) =>
        account.status === 'ACTIVE' && account.versions[0]?.accountSubtype === subtype,
    );

    if (matches.length === 0) {
      throw new BadRequestException(`POSTING_ACCOUNT_NOT_CONFIGURED:${subtype}`);
    }
    if (matches.length > 1) {
      throw new BadRequestException(`POSTING_ACCOUNT_AMBIGUOUS:${subtype}`);
    }

    const account = matches[0]!;
    return { id: account.id, code: account.code };
  }

  /**
   * Resolve by an explicit code when the caller supplied one (backward-compatible override),
   * otherwise resolve by role. Lets AR move to server-side resolution without breaking callers
   * that still send the codes.
   */
  async resolveByCodeOrRole(
    prisma: TenantPrisma,
    organizationId: string,
    code: string | undefined,
    subtype: AccountSubtype,
  ): Promise<ResolvedAccount> {
    if (code) {
      const account = await this.accountRepo.findByCode(prisma, organizationId, code);
      if (!account) throw new BadRequestException(`POSTING_ACCOUNT_NOT_FOUND:${code}`);
      return { id: account.id, code: account.code };
    }
    return this.resolve(prisma, organizationId, subtype);
  }
}
