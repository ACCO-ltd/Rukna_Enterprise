import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { AtRiskCommencementService } from './at-risk-commencement.service.js';
import type { RecordAtRiskCommencementDto } from '../presentation/dto/at-risk-commencement.dto.js';

function identity(roles: string[] = ['CFO']) {
  return {
    userId: 'u1',
    activeOrganizationId: 'org-1',
    tenantSlug: 'acco',
    roles,
    permissions: [],
  } as never;
}

function makeVo(status = 'PENDING_INTERNAL') {
  return {
    id: 'vo-1',
    organizationId: 'org-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status,
    lines: [],
  };
}

function build(opts: { vo?: ReturnType<typeof makeVo>; cap?: string } = {}) {
  const state = { vo: opts.vo ?? makeVo(), created: null as unknown };
  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;

  const repo = {
    findById: jest.fn(async () => state.vo),
    findContract: jest.fn().mockResolvedValue({
      id: 'c-1',
      projectId: 'p-1',
      organizationId: 'org-1',
      contractValue: new Decimal('1000000'),
      currency: 'USD',
      status: 'ACTIVE',
    }),
    createAtRiskAuthorisation: jest.fn(async (_tx: unknown, data: Record<string, unknown>) => {
      state.created = {
        id: 'auth-1',
        ...data,
        createdAt: new Date('2026-08-28T00:00:00Z'),
      };
      return state.created;
    }),
    findAtRiskAuthorisations: jest.fn(async () => []),
    // Sentinels: these MUST NOT be called by at-risk commencement (firewall).
    transition: jest.fn(),
    markBoqApplied: jest.fn(),
  };
  const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn(() => opts.cap ?? '25000') };

  const service = new AtRiskCommencementService(
    tenancy,
    repo as never,
    projectAccess as never,
    auditOutbox as never,
    config as never,
  );
  return { service, repo, auditOutbox, config, state };
}

const baseDto: RecordAtRiskCommencementDto = {
  exposureAmount: 18000,
  reason: 'Client needs the extra floor started now; VO in internal approval.',
  constructionDirectorUserId: 'cd-1',
  cfoUserId: 'cfo-1',
};

describe('AtRiskCommencementService (ADR-026 CONST-VAR-011, Route 7B)', () => {
  it('below the cap: records a CD+CFO authorisation, ceoRequired=false, ceoUserId null', async () => {
    const { service, repo } = build();
    const res = await service.record(identity(['CFO']), 'vo-1', baseDto);

    expect(res.ceoRequired).toBe(false);
    expect(res.ceoUserId).toBeNull();
    expect(res.exposureAmount).toBe('18000.00');
    expect(res.capAmount).toBe('25000.00');
    expect(res.currency).toBe('USD');
    const created = repo.createAtRiskAuthorisation.mock.calls[0][1];
    expect(created.ceoRequired).toBe(false);
    expect(created.voStatusAtAuth).toBe('PENDING_INTERNAL');
  });

  it('above the cap: requires the CEO (400 when ceoUserId missing)', async () => {
    const { service } = build();
    await expect(
      service.record(identity(['CFO']), 'vo-1', { ...baseDto, exposureAmount: 30000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('above the cap with a CEO: records ceoRequired=true and the CEO identity', async () => {
    const { service } = build();
    const res = await service.record(identity(['CEO']), 'vo-1', {
      ...baseDto,
      exposureAmount: 30000,
      ceoUserId: 'ceo-1',
    });
    expect(res.ceoRequired).toBe(true);
    expect(res.ceoUserId).toBe('ceo-1');
  });

  it('below the cap with a CEO supplied: rejected (CEO does not sign below the cap)', async () => {
    const { service } = build();
    await expect(
      service.record(identity(['CFO']), 'vo-1', { ...baseDto, ceoUserId: 'ceo-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('honours the config-driven cap (a higher cap keeps a 30k exposure below it, no CEO needed)', async () => {
    const { service } = build({ cap: '50000' });
    const res = await service.record(identity(['CFO']), 'vo-1', { ...baseDto, exposureAmount: 30000 });
    expect(res.ceoRequired).toBe(false);
    expect(res.capAmount).toBe('50000.00');
  });

  it('rejects a caller who is not CD/CFO/CEO (no informal path)', async () => {
    const { service } = build();
    await expect(
      service.record(identity(['PROJECT_MANAGER']), 'vo-1', baseDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a CLIENT_APPROVED VO (at-risk only applies before finalisation)', async () => {
    const { service } = build({ vo: makeVo('CLIENT_APPROVED') });
    await expect(service.record(identity(['CFO']), 'vo-1', baseDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('firewall: never moves the VO status/lifecycle nor touches contract value or BOQ', async () => {
    const { service, repo } = build();
    await service.record(identity(['CFO']), 'vo-1', baseDto);
    expect(repo.transition).not.toHaveBeenCalled();
    expect(repo.markBoqApplied).not.toHaveBeenCalled();
  });

  it('audits the authorisation with the firewall flags recorded', async () => {
    const { service, auditOutbox } = build();
    await service.record(identity(['CFO']), 'vo-1', baseDto);
    const evt = auditOutbox.record.mock.calls[0][1];
    expect(evt.eventType).toBe('VARIATION_ORDER_AT_RISK_COMMENCEMENT_AUTHORISED');
    expect(evt.after.contractValueChanged).toBe(false);
    expect(evt.after.boqChanged).toBe(false);
  });
});
