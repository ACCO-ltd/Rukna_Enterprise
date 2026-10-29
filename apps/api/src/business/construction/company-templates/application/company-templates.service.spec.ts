import { BadRequestException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { CompanyTemplatesService } from './company-templates.service.js';
import { DEFAULT_BUILDING_PHASES, DEFAULT_PAYMENT_PLAN } from '../domain/default-templates.js';

const identity: RequestIdentity = {
  userId: 'u-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 't',
  roles: [],
  permissions: [],
};

function build(stored: { paymentPlanTemplate?: unknown; scheduleTemplate?: unknown } = {}) {
  const state = { paymentPlanTemplate: null as unknown, scheduleTemplate: null as unknown, ...stored };
  const repo = {
    find: jest.fn(async () => ({ ...state })),
    setPaymentPlan: jest.fn(async (_p: unknown, _o: string, v: unknown) => { state.paymentPlanTemplate = v; }),
    setSchedule: jest.fn(async (_p: unknown, _o: string, v: unknown) => { state.scheduleTemplate = v; }),
  };
  const prisma = { $transaction: async (cb: (tx: unknown) => unknown) => cb(prisma) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CompanyTemplatesService({ getClient: () => prisma } as never, repo as never, audit as never);
  return { service, repo, audit };
}

describe('CompanyTemplatesService (Step 1b, ADR-047)', () => {
  it('serves the Rukna defaults until the company saves its own copy', async () => {
    const { service } = build();
    const res = await service.get(identity);
    expect(res.paymentPlan).toEqual({ rows: [...DEFAULT_PAYMENT_PLAN], isDefault: true });
    expect(res.schedule).toEqual({ phases: [...DEFAULT_BUILDING_PHASES], isDefault: true });
  });

  it('saves a valid payment plan (trimmed) and audits it', async () => {
    const { service, repo, audit } = build();
    const res = await service.savePaymentPlan(identity, [
      { name: ' Advance ', percentage: '25', isAdvance: true },
      { name: 'Handover', percentage: '75.00', isAdvance: false },
    ]);
    expect(repo.setPaymentPlan).toHaveBeenCalledWith(expect.anything(), 'org-1', [
      { name: 'Advance', percentage: '25', isAdvance: true },
      { name: 'Handover', percentage: '75', isAdvance: false },
    ]);
    expect(res.paymentPlan.isDefault).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'COMPANY_TEMPLATE_SAVED', resourceId: 'org-1:PAYMENT_PLAN' }),
    );
  });

  it('rejects an invalid plan with every problem listed and writes nothing', async () => {
    const { service, repo } = build();
    await expect(
      service.savePaymentPlan(identity, [{ name: 'A', percentage: '60', isAdvance: false }]),
    ).rejects.toThrow(BadRequestException);
    expect(repo.setPaymentPlan).not.toHaveBeenCalled();
  });

  it('reset writes NULL so the default is back in force', async () => {
    const { service, repo, audit } = build({ scheduleTemplate: [{ name: 'X', durationDays: 3, scheduleOnly: false }] });
    const res = await service.reset(identity, 'SCHEDULE');
    expect(repo.setSchedule).toHaveBeenCalledWith(expect.anything(), 'org-1', null);
    expect(res.schedule.isDefault).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'COMPANY_TEMPLATE_RESET' }));
  });

  it('schedulePhases returns the company copy, else the default', async () => {
    const own = [{ name: 'X', durationDays: 3, scheduleOnly: false }];
    expect(await build({ scheduleTemplate: own }).service.schedulePhases('org-1')).toEqual(own);
    expect(await build().service.schedulePhases('org-1')).toBe(DEFAULT_BUILDING_PHASES);
  });
});
