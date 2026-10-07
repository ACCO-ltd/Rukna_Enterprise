import type { PrismaClient } from '@prisma/client';

import {
  QUOTATION_AWARD_BAND_SET,
  QUOTATION_SOD_RULES,
  seedQuotationAwardBands,
} from '../../src/platform/workflows/seeders/acco-workflows.seed.js';

/**
 * ADR-044 §6/§7 — the quotation governance a live tenant needs, without re-running the whole ACCO
 * governance seed (which also re-asserts the policy version and every other rule):
 *
 *  1. the two selection SoD rules (`QUOTE_UPLOADER_CANNOT_SELECT`, `REQUESTER_CANNOT_SELECT`),
 *     created ACTIVE under the tenant's ACTIVE `ACCO_GOVERNANCE` policy version. An existing rule
 *     is left exactly as it is (an admin may have switched it off deliberately).
 *  2. the quotation award value bands (the PO bands, bound to QuotationRequest
 *     AWAITING_DECISION → AWARDED), seeded INACTIVE. They are activated only together with the PO
 *     bands (`dev-activate-doa-bands.seed.ts` refuses one without the other).
 *
 * Idempotent: a second run creates nothing.
 */

export type QuotationSodSeedResult =
  | { status: 'policy-missing' }
  | { status: 'ok'; created: string[]; alreadyPresent: string[]; awardBandsBefore: number; awardBandsAfter: number };

export async function grantQuotationGovernance(
  prisma: PrismaClient,
  organizationId: string,
): Promise<QuotationSodSeedResult> {
  const policy = await prisma.workflowPolicyVersion.findFirst({
    where: { organizationId, policyKey: 'ACCO_GOVERNANCE', status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  if (!policy) return { status: 'policy-missing' };

  const created: string[] = [];
  const alreadyPresent: string[] = [];
  for (const [code, description] of QUOTATION_SOD_RULES) {
    const existing = await prisma.segregationOfDutiesRule.findUnique({
      where: { organizationId_code: { organizationId, code } },
      select: { id: true },
    });
    if (existing) {
      alreadyPresent.push(code);
      continue;
    }
    await prisma.segregationOfDutiesRule.create({
      data: { organizationId, workflowPolicyVersionId: policy.id, code, description, isActive: true },
    });
    created.push(code);
  }

  const countBands = () =>
    prisma.workflowTriggerBinding.count({
      where: {
        organizationId,
        entityType: QUOTATION_AWARD_BAND_SET.entityType,
        fromState: QUOTATION_AWARD_BAND_SET.fromState,
        toState: QUOTATION_AWARD_BAND_SET.toState,
      },
    });
  const awardBandsBefore = await countBands();
  await seedQuotationAwardBands(prisma, organizationId);
  const awardBandsAfter = await countBands();

  return { status: 'ok', created, alreadyPresent, awardBandsBefore, awardBandsAfter };
}
