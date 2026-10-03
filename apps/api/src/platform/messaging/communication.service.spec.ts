import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import type { MessageStatus, OutboundMessage } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { CommunicationService, type SendWhatsAppTemplateInput } from './communication.service';
import { canTransition } from './domain/message-status';
import { tenancyStorage } from '../tenancy/tenancy.context';
import { WhatsAppSendError } from './whatsapp/whatsapp.client';

/** In-memory stand-in for OutboundMessageRepository with the same guards the DB enforces. */
class FakeRepo {
  rows: OutboundMessage[] = [];
  private seq = 0;
  /** When set, the next create() loses a race to a concurrent request with the same key. */
  raceWinner: Partial<OutboundMessage> | null = null;

  findByKey = jest.fn(
    async (_db: unknown, org: string, key: string) =>
      this.rows.find((r) => r.organizationId === org && r.idempotencyKey === key) ?? null,
  );
  findById = jest.fn(
    async (_db: unknown, id: string) => this.rows.find((r) => r.id === id) ?? null,
  );
  findByProviderId = jest.fn(
    async (_db: unknown, pid: string) => this.rows.find((r) => r.providerMessageId === pid) ?? null,
  );
  create = jest.fn(async (_db: unknown, data: Partial<OutboundMessage>) => {
    if (this.raceWinner) {
      this.insert({ ...data, ...this.raceWinner });
      this.raceWinner = null;
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    if (
      this.rows.some(
        (r) => r.organizationId === data.organizationId && r.idempotencyKey === data.idempotencyKey,
      )
    ) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    return this.insert(data);
  });
  rearmFailed = jest.fn(async (_db: unknown, id: string, data: Partial<OutboundMessage>) => {
    const row = this.rows.find((r) => r.id === id && r.status === 'FAILED');
    if (!row) return false;
    Object.assign(row, data, {
      status: 'QUEUED',
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      providerMessageId: null,
    });
    return true;
  });
  attachProviderId = jest.fn(async (_db: unknown, id: string, providerMessageId: string) => {
    const row = this.rows.find((r) => r.id === id && r.status === 'QUEUED' && !r.providerMessageId);
    if (row) row.providerMessageId = providerMessageId;
    return !!row;
  });
  markSent = jest.fn(async (_db: unknown, id: string, providerMessageId: string, sentAt: Date) => {
    const row = this.rows.find((r) => r.id === id)!;
    if (row.status === 'QUEUED') Object.assign(row, { status: 'SENT', providerMessageId, sentAt });
    if (!row.sentAt && row.status !== 'FAILED') row.sentAt = sentAt;
    return row;
  });
  markUnknown = jest.fn(async (_db: unknown, id: string, errorCode: string, errorMessage: string) =>
    Object.assign(
      this.rows.find((r) => r.id === id)!,
      { status: 'UNKNOWN', errorCode, errorMessage },
    ),
  );
  fillMissingTimestamps = jest.fn(
    async (_db: unknown, pid: string, fields: Array<'sentAt' | 'deliveredAt'>, at: Date) => {
      const row = this.rows.find((r) => r.providerMessageId === pid);
      for (const f of fields) if (row && !row[f]) row[f] = at;
    },
  );
  listStale = jest.fn(async (_db: unknown, org: string, statuses: MessageStatus[], before: Date) =>
    this.rows.filter(
      (r) => r.organizationId === org && statuses.includes(r.status) && r.queuedAt < before,
    ),
  );
  markFailed = jest.fn(
    async (_db: unknown, id: string, errorCode: string, errorMessage: string, failedAt: Date) =>
      Object.assign(
        this.rows.find((r) => r.id === id)!,
        { status: 'FAILED', errorCode, errorMessage, failedAt },
      ),
  );
  applyStatus = jest.fn(
    async (_db: unknown, pid: string, from: MessageStatus[], data: Partial<OutboundMessage>) => {
      const row = this.rows.find((r) => r.providerMessageId === pid && from.includes(r.status));
      if (!row) return false;
      Object.assign(row, data);
      return true;
    },
  );
  listForResource = jest.fn(async () => this.rows);

  insert(data: Partial<OutboundMessage>): OutboundMessage {
    const now = new Date();
    const row = {
      id: `m${++this.seq}`,
      status: 'QUEUED',
      queuedAt: now,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      providerMessageId: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    } as OutboundMessage;
    this.rows.push(row);
    return row;
  }
}

const identity: RequestIdentity = {
  userId: 'u1',
  activeOrganizationId: 'org1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

const input = (over: Partial<SendWhatsAppTemplateInput> = {}): SendWhatsAppTemplateInput => ({
  purpose: 'INVOICE',
  clientId: 'c1',
  recipient: '+252612345678',
  resourceType: 'client_invoice',
  resourceId: 'inv1',
  templateName: 'rukna_invoice',
  language: 'en',
  bodyParams: ['Hodan', 'INV-1'],
  document: { bytes: Buffer.from('%PDF'), mimeType: 'application/pdf', filename: 'INV-1.pdf' },
  idempotencyKey: 'invoice-send:inv1:1',
  ...over,
});

function setup() {
  const repo = new FakeRepo();
  const db = { $transaction: (fn: (tx: unknown) => unknown) => fn(db) };
  const tenancy = { getClient: () => db };
  const routes = { record: jest.fn().mockResolvedValue(undefined), findTenantSlug: jest.fn() };
  const whatsapp = {
    uploadMedia: jest.fn().mockResolvedValue('MEDIA1'),
    sendTemplate: jest.fn().mockResolvedValue({ providerMessageId: 'wamid.1' }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CommunicationService(
    tenancy as never,
    repo as never,
    routes as never,
    whatsapp as never,
    audit as never,
  );
  const run = <T>(fn: () => Promise<T>) =>
    tenancyStorage.run({ tenantId: 'tenant-1', tenantSlug: 'acco', client: db as never }, fn);
  return { repo, routes, whatsapp, audit, service, run };
}

describe('CommunicationService (ADR-042 phase 2)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends once: QUEUED → uploads media → sends → SENT, records the route and an audit row', async () => {
    const { service, whatsapp, routes, audit, run, repo } = setup();
    const view = await run(() => service.sendWhatsAppTemplate(identity, input()));

    expect(view.status).toBe('SENT');
    expect(view.sentAt).not.toBeNull();
    expect(whatsapp.uploadMedia).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/pdf',
      'INV-1.pdf',
    );
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith({
      to: '+252612345678',
      templateName: 'rukna_invoice',
      language: 'en',
      bodyParams: ['Hodan', 'INV-1'],
      document: { mediaId: 'MEDIA1', filename: 'INV-1.pdf' },
    });
    expect(routes.record).toHaveBeenCalledWith('wamid.1', 'tenant-1');
    expect(repo.rows[0].providerMessageId).toBe('wamid.1');
    const auditCall = audit.record.mock.calls[0][1];
    expect(auditCall).toMatchObject({
      resourceType: 'outbound-message',
      action: 'whatsapp.sent',
      actorUserId: 'u1',
    });
    expect(JSON.stringify(auditCall)).not.toContain('252612345678');
    expect(auditCall.after.recipient).toBe('…5678');
  });

  it('is idempotent: a repeat with the same key returns the same row and does not send again', async () => {
    const { service, whatsapp, run } = setup();
    const first = await run(() => service.sendWhatsAppTemplate(identity, input()));
    const again = await run(() =>
      service.sendWhatsAppTemplate(identity, input({ bodyParams: ['changed'] })),
    );
    expect(again).toEqual(first);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('does not resend a row stuck in QUEUED', async () => {
    const { service, whatsapp, repo, run } = setup();
    repo.insert({
      organizationId: 'org1',
      idempotencyKey: 'k',
      recipient: '+252612345678',
      purpose: 'INVOICE',
      resourceType: 'client_invoice',
      resourceId: 'inv1',
    });
    const view = await run(() =>
      service.sendWhatsAppTemplate(identity, input({ idempotencyKey: 'k' })),
    );
    expect(view.status).toBe('QUEUED');
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('P2002 race: the loser returns the winner’s row and sends nothing', async () => {
    const { service, whatsapp, repo, run } = setup();
    repo.raceWinner = { status: 'SENT', providerMessageId: 'wamid.winner' };
    const view = await run(() => service.sendWhatsAppTemplate(identity, input()));
    expect(view.status).toBe('SENT');
    expect(repo.rows).toHaveLength(1);
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('provider failure → FAILED row with a typed code and plain words; no throw, no route', async () => {
    const { service, whatsapp, routes, audit, run } = setup();
    whatsapp.sendTemplate.mockRejectedValue(
      new WhatsAppSendError('INVALID_RECIPIENT', 'Not on WhatsApp.', 131026),
    );
    const view = await run(() => service.sendWhatsAppTemplate(identity, input()));
    expect(view).toMatchObject({
      status: 'FAILED',
      errorCode: 'INVALID_RECIPIENT',
      errorMessage: 'Not on WhatsApp.',
    });
    expect(view.failedAt).not.toBeNull();
    expect(routes.record).not.toHaveBeenCalled();
    expect(audit.record.mock.calls[0][1].action).toBe('whatsapp.failed');
  });

  it('media upload failure → FAILED without attempting the send', async () => {
    const { service, whatsapp, run } = setup();
    whatsapp.uploadMedia.mockRejectedValue(
      new WhatsAppSendError('MEDIA_UPLOAD_FAILED', 'Bad document.'),
    );
    const view = await run(() => service.sendWhatsAppTemplate(identity, input()));
    expect(view.errorCode).toBe('MEDIA_UPLOAD_FAILED');
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('retry of a FAILED message reuses the row and sends again', async () => {
    const { service, whatsapp, repo, run } = setup();
    whatsapp.sendTemplate.mockRejectedValueOnce(
      new WhatsAppSendError('NETWORK', 'Could not reach WhatsApp.'),
    );
    const failed = await run(() => service.sendWhatsAppTemplate(identity, input()));
    const retried = await run(() =>
      service.sendWhatsAppTemplate(identity, input({ recipient: '+252615550142' })),
    );
    expect(retried.id).toBe(failed.id);
    expect(retried).toMatchObject({ status: 'SENT', recipient: '+252615550142', errorCode: null });
    expect(repo.rows).toHaveLength(1);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(2);
  });

  it('an unexpected (non-provider) error marks the row FAILED and is rethrown', async () => {
    const { service, whatsapp, repo, run } = setup();
    whatsapp.sendTemplate.mockRejectedValue(new Error('bug'));
    await expect(run(() => service.sendWhatsAppTemplate(identity, input()))).rejects.toThrow('bug');
    expect(repo.rows[0]).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' });
  });

  it('a route write failure does not fail a message Meta accepted', async () => {
    const { service, routes, run } = setup();
    routes.record.mockRejectedValue(new Error('platform db down'));
    expect((await run(() => service.sendWhatsAppTemplate(identity, input()))).status).toBe('SENT');
  });

  it.each([
    [{ recipient: '0612345678' }, 'recipient'],
    [{ idempotencyKey: ' ' }, 'idempotencyKey'],
    [{ templateName: '' }, 'templateName'],
    [{ resourceId: '' }, 'resource'],
    [
      { document: { bytes: Buffer.alloc(0), mimeType: 'application/pdf', filename: 'a.pdf' } },
      'document',
    ],
  ])('invalid input %j throws (programming error) before any write', async (over, field) => {
    const { service, repo, run } = setup();
    await expect(
      run(() => service.sendWhatsAppTemplate(identity, input(over as never))),
    ).rejects.toThrow(BadRequestException);
    await run(() => service.sendWhatsAppTemplate(identity, input(over as never))).catch(
      (e: BadRequestException) => expect((e.getResponse() as { field: string }).field).toBe(field),
    );
    expect(repo.rows).toHaveLength(0);
  });

  it('send went out but Meta never answered → UNKNOWN (not FAILED); a repeat does not resend', async () => {
    const { service, whatsapp, routes, audit, run } = setup();
    whatsapp.sendTemplate.mockRejectedValue(
      new WhatsAppSendError('NETWORK', 'WhatsApp did not answer in time.', undefined, true),
    );
    const view = await run(() => service.sendWhatsAppTemplate(identity, input()));
    expect(view).toMatchObject({ status: 'UNKNOWN', errorCode: 'OUTCOME_UNKNOWN', failedAt: null });
    expect(view.errorMessage).toMatch(/may or may not/);
    expect(routes.record).not.toHaveBeenCalled();
    expect(audit.record.mock.calls[0][1].action).toBe('whatsapp.unknown');

    const again = await run(() => service.sendWhatsAppTemplate(identity, input()));
    expect(again.status).toBe('UNKNOWN');
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('a network failure during media upload (nothing sent yet) is a definite FAILED', async () => {
    const { service, whatsapp, run } = setup();
    whatsapp.uploadMedia.mockRejectedValue(
      new WhatsAppSendError('NETWORK', 'Could not reach WhatsApp.'),
    );
    expect((await run(() => service.sendWhatsAppTemplate(identity, input()))).status).toBe(
      'FAILED',
    );
  });

  it.each([
    [{ purpose: 'RECEIPT' as const }],
    [{ resourceType: 'payment_receipt' }],
    [{ resourceId: 'inv2' }],
  ])(
    'a key reused for a different message (%j) → 409 IDEMPOTENCY_KEY_REUSED, nothing sent',
    async (over) => {
      const { service, whatsapp, run } = setup();
      whatsapp.sendTemplate.mockRejectedValueOnce(new WhatsAppSendError('INVALID_RECIPIENT', 'x'));
      await run(() => service.sendWhatsAppTemplate(identity, input()));
      const err = await run(() => service.sendWhatsAppTemplate(identity, input(over))).catch(
        (e: ConflictException) => e,
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect(((err as ConflictException).getResponse() as { code: string }).code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
      expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    },
  );

  it('a webhook that lands before markSent finds the row (provider id stored before the route) and wins', async () => {
    const { service, routes, run, repo } = setup();
    routes.record.mockImplementation(async (pid: string) => {
      expect(repo.rows[0].providerMessageId).toBe(pid);
      expect(
        await service.applyStatusUpdate({
          providerMessageId: pid,
          status: 'delivered',
          timestamp: '1727780000',
        }),
      ).toBe('applied');
    });
    const view = await run(() => service.sendWhatsAppTemplate(identity, input()));
    expect(view.status).toBe('DELIVERED');
    expect(view.sentAt).not.toBeNull();
    expect(view.deliveredAt).toBe(new Date(1727780000 * 1000).toISOString());
  });

  it('listStale returns QUEUED/UNKNOWN rows older than the cutoff, org-scoped', async () => {
    const { service, repo, run } = setup();
    const old = new Date(Date.now() - 60 * 60_000);
    repo.insert({ organizationId: 'org1', status: 'UNKNOWN', queuedAt: old });
    repo.insert({ organizationId: 'org1', status: 'QUEUED', queuedAt: old });
    repo.insert({ organizationId: 'org1', status: 'QUEUED', queuedAt: new Date() });
    repo.insert({ organizationId: 'org1', status: 'SENT', queuedAt: old });
    repo.insert({ organizationId: 'org2', status: 'QUEUED', queuedAt: old });
    const stale = await run(() => service.listStale(identity, 30));
    expect(stale.map((m) => m.status).sort()).toEqual(['QUEUED', 'UNKNOWN']);
    await expect(run(() => service.listStale(identity, -1))).rejects.toThrow(BadRequestException);
  });

  describe('applyStatusUpdate', () => {
    it('a jump ahead fills the skipped timestamps that are still null', async () => {
      const ctx = setup();
      ctx.repo.insert({ organizationId: 'org1', status: 'QUEUED', providerMessageId: 'wamid.J' });
      expect(
        await ctx.service.applyStatusUpdate({
          providerMessageId: 'wamid.J',
          status: 'read',
          timestamp: '1727780000',
        }),
      ).toBe('applied');
      const at = new Date(1727780000 * 1000);
      expect(ctx.repo.rows[0]).toMatchObject({
        status: 'READ',
        readAt: at,
        deliveredAt: at,
        sentAt: at,
      });
    });

    async function sent() {
      const ctx = setup();
      await ctx.run(() => ctx.service.sendWhatsAppTemplate(identity, input()));
      return ctx;
    }

    it('moves forward and sets the matching timestamp from Meta’s unix seconds', async () => {
      const { service, repo } = await sent();
      expect(
        await service.applyStatusUpdate({
          providerMessageId: 'wamid.1',
          status: 'delivered',
          timestamp: '1727780000',
        }),
      ).toBe('applied');
      expect(repo.rows[0].status).toBe('DELIVERED');
      expect(repo.rows[0].deliveredAt).toEqual(new Date(1727780000 * 1000));
      expect(
        await service.applyStatusUpdate({
          providerMessageId: 'wamid.1',
          status: 'read',
          timestamp: '1727780100',
        }),
      ).toBe('applied');
      expect(repo.rows[0].status).toBe('READ');
    });

    it('ignores repeats and late regressions', async () => {
      const { service, repo } = await sent();
      await service.applyStatusUpdate({
        providerMessageId: 'wamid.1',
        status: 'read',
        timestamp: '2',
      });
      expect(
        await service.applyStatusUpdate({
          providerMessageId: 'wamid.1',
          status: 'read',
          timestamp: '3',
        }),
      ).toBe('ignored');
      expect(
        await service.applyStatusUpdate({
          providerMessageId: 'wamid.1',
          status: 'delivered',
          timestamp: '4',
        }),
      ).toBe('ignored');
      expect(
        await service.applyStatusUpdate({
          providerMessageId: 'wamid.1',
          status: 'sent',
          timestamp: '5',
        }),
      ).toBe('ignored');
      expect(repo.rows[0].status).toBe('READ');
    });

    it('FAILED overrides DELIVERED with Meta’s code and plain words, but never READ', async () => {
      const { service, repo } = await sent();
      await service.applyStatusUpdate({ providerMessageId: 'wamid.1', status: 'delivered' });
      expect(
        await service.applyStatusUpdate({
          providerMessageId: 'wamid.1',
          status: 'failed',
          errors: [{ code: 131026, title: 'x' }],
        }),
      ).toBe('applied');
      expect(repo.rows[0]).toMatchObject({ status: 'FAILED', errorCode: '131026' });
      expect(repo.rows[0].errorMessage).toMatch(/cannot receive WhatsApp/);
      expect(
        await service.applyStatusUpdate({ providerMessageId: 'wamid.1', status: 'read' }),
      ).toBe('ignored');

      const other = await sent();
      await other.service.applyStatusUpdate({ providerMessageId: 'wamid.1', status: 'read' });
      expect(
        await other.service.applyStatusUpdate({ providerMessageId: 'wamid.1', status: 'failed' }),
      ).toBe('ignored');
      expect(other.repo.rows[0].status).toBe('READ');
    });

    it('unknown provider id → not_found; unknown status word → ignored', async () => {
      const { service } = await sent();
      expect(
        await service.applyStatusUpdate({ providerMessageId: 'wamid.nope', status: 'read' }),
      ).toBe('not_found');
      expect(
        await service.applyStatusUpdate({ providerMessageId: 'wamid.1', status: 'deleted' }),
      ).toBe('ignored');
    });

    it('transition table', () => {
      expect(canTransition('QUEUED', 'SENT')).toBe(true);
      expect(canTransition('SENT', 'READ')).toBe(true);
      expect(canTransition('DELIVERED', 'SENT')).toBe(false);
      expect(canTransition('SENT', 'FAILED')).toBe(true);
      expect(canTransition('READ', 'FAILED')).toBe(false);
      expect(canTransition('FAILED', 'DELIVERED')).toBe(false);
      expect(canTransition('FAILED', 'FAILED')).toBe(false);
      expect(canTransition('UNKNOWN', 'DELIVERED')).toBe(true);
      expect(canTransition('UNKNOWN', 'FAILED')).toBe(true);
      expect(canTransition('QUEUED', 'UNKNOWN')).toBe(false);
    });
  });

  describe('status hooks', () => {
    function hooked() {
      const ctx = setup();
      const onSent = jest.fn().mockResolvedValue(undefined);
      const onFailed = jest.fn().mockResolvedValue(undefined);
      ctx.service.registerStatusHooks('client_invoice', { onSent, onFailed });
      return { ...ctx, onSent, onFailed };
    }

    it('refuses a second registration for the same resourceType', () => {
      const { service } = hooked();
      expect(() => service.registerStatusHooks('client_invoice', {})).toThrow(/already registered/);
    });

    it('runs onSent inside the send transaction with the sender as actor', async () => {
      const { service, run, onSent, onFailed } = hooked();
      const view = await run(() => service.sendWhatsAppTemplate(identity, input()));
      expect(onSent).toHaveBeenCalledTimes(1);
      expect(onSent.mock.calls[0][1]).toEqual({
        organizationId: 'org1',
        actorUserId: identity.userId,
      });
      expect(onSent.mock.calls[0][2]).toMatchObject({ id: view.id, status: 'SENT' });
      expect(onFailed).not.toHaveBeenCalled();
    });

    it('does not run onSent for a refused or unanswered send', async () => {
      const { service, run, whatsapp, onSent } = hooked();
      whatsapp.sendTemplate.mockRejectedValueOnce(new WhatsAppSendError('INVALID_RECIPIENT', 'no'));
      await run(() => service.sendWhatsAppTemplate(identity, input({ idempotencyKey: 'a' })));
      whatsapp.sendTemplate.mockRejectedValueOnce(
        new WhatsAppSendError('NETWORK', 'timeout', undefined, true),
      );
      await run(() => service.sendWhatsAppTemplate(identity, input({ idempotencyKey: 'b' })));
      expect(onSent).not.toHaveBeenCalled();
    });

    it('a FAILED webhook runs onFailed with the creator as actor; a forward webhook runs onSent', async () => {
      const { service, run, onSent, onFailed } = hooked();
      await run(() => service.sendWhatsAppTemplate(identity, input()));
      onSent.mockClear();
      await service.applyStatusUpdate({ providerMessageId: 'wamid.1', status: 'delivered' });
      expect(onSent).toHaveBeenCalledTimes(1);
      await service.applyStatusUpdate({
        providerMessageId: 'wamid.1',
        status: 'failed',
        errors: [{ code: 131026 }],
      });
      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(onFailed.mock.calls[0][1]).toEqual({
        organizationId: 'org1',
        actorUserId: identity.userId,
      });
      expect(onFailed.mock.calls[0][2]).toMatchObject({ status: 'FAILED' });
      // An ignored update (FAILED is terminal) runs nothing.
      await service.applyStatusUpdate({ providerMessageId: 'wamid.1', status: 'failed' });
      expect(onFailed).toHaveBeenCalledTimes(1);
    });
  });
});
