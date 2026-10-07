import { Logger } from '@nestjs/common';

import { tenancyStorage } from '../tenancy/tenancy.context';
import { OutboundMessageDispatcher } from './outbound-message-dispatcher.service';

const zero = { sent: 0, retrying: 0, failed: 0, unknown: 0, cancelled: 0 };

function build(configured: boolean) {
  const platform = { tenant: { findMany: jest.fn().mockResolvedValue([{ slug: 'acco' }, { slug: 'bad' }, { slug: 'other' }]) } };
  const tenancy = {
    resolveTenant: jest.fn(async (slug: string) => {
      if (slug === 'bad') throw new Error('no db');
      return { tenantId: `t-${slug}`, tenantSlug: slug, client: {} };
    }),
  };
  const seen: string[] = [];
  const communication = {
    isWhatsAppConfigured: () => configured,
    dispatchDue: jest.fn(async () => {
      seen.push(tenancyStorage.getStore()!.tenantSlug);
      return { ...zero, sent: 1 };
    }),
  };
  const dispatcher = new OutboundMessageDispatcher(platform as never, tenancy as never, communication as never);
  return { dispatcher, communication, platform, seen };
}

describe('OutboundMessageDispatcher (ADR-044 phase 2)', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs dispatchDue inside each ACTIVE tenant context; one bad tenant does not stop the rest', async () => {
    const { dispatcher, seen, platform } = build(true);
    const total = await dispatcher.dispatchAllTenants();
    expect(platform.tenant.findMany).toHaveBeenCalledWith({ where: { status: 'ACTIVE' }, select: { slug: true } });
    expect(seen).toEqual(['acco', 'other']);
    expect(total).toEqual({ ...zero, sent: 2 });
  });

  it('skips quietly (rows stay queued) while WhatsApp is not configured', async () => {
    const { dispatcher, communication, platform } = build(false);
    await expect(dispatcher.dispatchAllTenants()).resolves.toEqual(zero);
    await dispatcher.handleCron();
    expect(communication.dispatchDue).not.toHaveBeenCalled();
    expect(platform.tenant.findMany).not.toHaveBeenCalled();
  });

  it('never overlaps two cron runs in one process', async () => {
    const { dispatcher, platform } = build(true);
    let release!: () => void;
    platform.tenant.findMany.mockImplementationOnce(() => new Promise((r) => (release = () => r([])))) ;
    const first = dispatcher.handleCron();
    await dispatcher.handleCron(); // returns at once: the first is still running
    release();
    await first;
    expect(platform.tenant.findMany).toHaveBeenCalledTimes(1);
  });
});
