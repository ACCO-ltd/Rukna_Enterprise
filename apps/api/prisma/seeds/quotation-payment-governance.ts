import type { PrismaClient } from '@prisma/client';

import {
  BUYER_ADVANCE_BAND_SET,
  QUOTATION_PAYMENT_SOD_RULES,
  seedBuyerAdvanceBands,
} from '../../src/platform/workflows/seeders/acco-workflows.seed.js';
import { STAFF_ADVANCES_CODE } from '../../src/business/accounting/accounting-setup/templates/construction.js';
import { STAFF_ADVANCE_PROFILE_CODE } from '../../src/business/accounting/accounts-payable/domain/staff-advance-profile.js';

/**
 * ADR-045 — what a live tenant needs to pay from a quotation award, without re-running the whole
 * governance seed. Targeted, additive and idempotent (a second run creates nothing):
 *
 *  1. the SoD rule `ADVANCE_RECIPIENT_CANNOT_RELEASE`, created ACTIVE under the tenant's ACTIVE
 *     `ACCO_GOVERNANCE` policy version; an existing rule is left exactly as it is;
 *  2. the BuyerAdvance band bindings (DRAFT → APPROVED) on the supplier-payment band definitions,
 *     each taking the state of the supplier-payment binding on the same definition (one control);
 *  3. the posting profile `STAFF_ADVANCE` → 13100 Staff advances, when the chart has 13100 and the
 *     profile does not exist yet. Effective from the account's own first version, so every date the
 *     account can post on resolves the profile.
 */
export type QuotationPaymentSeedResult =
  | { status: 'policy-missing' }
  | {
      status: 'ok';
      sodCreated: string[];
      sodAlreadyPresent: string[];
      advanceBindingsBefore: number;
      advanceBindingsAfter: number;
      staffAdvanceProfile: 'created' | 'already-present' | 'no-13100-account';
    };

export async function grantQuotationPaymentGovernance(
  prisma: PrismaClient,
  organizationId: string,
  actorUserId = 'seed:quotation-payment',
): Promise<QuotationPaymentSeedResult> {
  const policy = await prisma.workflowPolicyVersion.findFirst({
    where: { organizationId, policyKey: 'ACCO_GOVERNANCE', status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  if (!policy) return { status: 'policy-missing' };

  const sodCreated: string[] = [];
  const sodAlreadyPresent: string[] = [];
  for (const [code, description] of QUOTATION_PAYMENT_SOD_RULES) {
    const existing = await prisma.segregationOfDutiesRule.findUnique({
      where: { organizationId_code: { organizationId, code } },
      select: { id: true },
    });
    if (existing) {
      sodAlreadyPresent.push(code);
      continue;
    }
    await prisma.segregationOfDutiesRule.create({
      data: { organizationId, workflowPolicyVersionId: policy.id, code, description, isActive: true },
    });
    sodCreated.push(code);
  }

  const countBindings = () =>
    prisma.workflowTriggerBinding.count({
      where: {
        organizationId,
        entityType: BUYER_ADVANCE_BAND_SET.entityType,
        fromState: BUYER_ADVANCE_BAND_SET.fromState,
        toState: BUYER_ADVANCE_BAND_SET.toState,
      },
    });
  const advanceBindingsBefore = await countBindings();
  const log = console.log;
  console.log = () => undefined;
  try {
    await seedBuyerAdvanceBands(prisma, organizationId);
  } finally {
    console.log = log;
  }
  const advanceBindingsAfter = await countBindings();

  return {
    status: 'ok',
    sodCreated,
    sodAlreadyPresent,
    advanceBindingsBefore,
    advanceBindingsAfter,
    staffAdvanceProfile: await ensureStaffAdvanceProfile(prisma, organizationId, actorUserId),
  };
}

async function ensureStaffAdvanceProfile(
  prisma: PrismaClient,
  organizationId: string,
  actorUserId: string,
): Promise<'created' | 'already-present' | 'no-13100-account'> {
  const existing = await prisma.postingProfile.findUnique({
    where: { organizationId_code: { organizationId, code: STAFF_ADVANCE_PROFILE_CODE } },
    select: { id: true },
  });
  if (existing) return 'already-present';
  const account = await prisma.account.findUnique({
    where: { organizationId_code: { organizationId, code: STAFF_ADVANCES_CODE } },
    include: { versions: { orderBy: { versionNumber: 'asc' } } },
  });
  const first = account?.versions[0];
  if (!account || !first || account.status !== 'ACTIVE' || first.accountClass !== 'ASSET') return 'no-13100-account';
  const latest = account.versions[account.versions.length - 1]!;
  await prisma.postingProfile.create({
    data: {
      organizationId,
      code: STAFF_ADVANCE_PROFILE_CODE,
      status: 'ACTIVE',
      createdBy: actorUserId,
      versions: {
        create: {
          versionNumber: 1,
          name: latest.name,
          accountId: account.id,
          effectiveFrom: first.effectiveFrom,
          changedBy: actorUserId,
        },
      },
    },
  });
  return 'created';
}
