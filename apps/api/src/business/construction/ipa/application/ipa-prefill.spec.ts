import type { RequestIdentity } from '@erp/types';

import { IpaService } from './ipa.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

function build(opts: { progress?: unknown[]; prevCertified?: number }) {
  const prisma = {
    contract: { findFirst: jest.fn().mockResolvedValue({ id: 'c-1', projectId: 'p-1' }) },
  };
  const tenancyService = { getClient: () => prisma };
  const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
  const repo = {
    getLastEffectiveCertifiedQty: jest.fn().mockResolvedValue(opts.prevCertified ?? 0),
  };
  const progress = {
    getProjectProgress: jest.fn().mockResolvedValue(opts.progress ?? []),
  };
  const service = new IpaService(
    tenancyService as never,
    {} as never, // commandGovernance (unused by getPrefill)
    repo as never,
    projectAccess as never,
    {} as never, // auditOutbox (unused)
    progress as never,
  );
  return { service, repo };
}

const line = (over: Partial<Record<string, string>> = {}) => ({
  boqNodeId: 'n1',
  code: '1.1',
  description: 'Excavation',
  measurableQuantity: '1000',
  verifiedToDate: '240',
  ...over,
});

describe('IpaService.getPrefill (ADR-021/023 firewall-safe)', () => {
  it('suggests cumulative = verified and period = verified − previously certified', async () => {
    const { service } = build({ progress: [line()], prevCertified: 100 });
    const res = await service.getPrefill(identity, 'c-1');
    expect(res.source).toBe('VERIFIED_PROGRESS');
    expect(res.suggestions).toHaveLength(1);
    const s = res.suggestions[0];
    expect(s.suggestedCumulativeClaim).toBe('240');
    expect(s.previousEffectiveCertified).toBe('100');
    expect(s.suggestedPeriodClaim).toBe('140');
  });

  it('skips BOQ lines with zero verified progress', async () => {
    const { service } = build({ progress: [line({ verifiedToDate: '0' })] });
    const res = await service.getPrefill(identity, 'c-1');
    expect(res.suggestions).toHaveLength(0);
  });

  it('clamps the suggested claim to the BOQ measurable quantity', async () => {
    const { service } = build({ progress: [line({ verifiedToDate: '1200', measurableQuantity: '1000' })] });
    const res = await service.getPrefill(identity, 'c-1');
    expect(res.suggestions[0].suggestedCumulativeClaim).toBe('1000');
  });

  it('never suggests below what was already certified (no un-claiming)', async () => {
    const { service } = build({ progress: [line({ verifiedToDate: '80' })], prevCertified: 100 });
    const res = await service.getPrefill(identity, 'c-1');
    expect(res.suggestions[0].suggestedCumulativeClaim).toBe('100');
    expect(res.suggestions[0].suggestedPeriodClaim).toBe('0');
  });
});
