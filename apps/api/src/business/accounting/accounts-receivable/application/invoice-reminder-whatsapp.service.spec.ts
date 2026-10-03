import type { OutboundMessageView, RequestIdentity } from '@erp/types';

import {
  CLIENT_INVOICE_REMINDER_RESOURCE,
  InvoiceReminderWhatsAppService,
} from './invoice-reminder-whatsapp.service';
import {
  hasOutstanding,
  isRemindable,
  reminderInvoiceReference,
  reminderBlockedReason,
  reminderDaysPastDue,
  reminderKind,
} from '../domain/invoice-reminder';

const identity: RequestIdentity = {
  userId: 'u1',
  activeOrganizationId: 'org1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

const NOW = new Date('2026-10-03T09:00:00Z');

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv1',
  organizationId: 'org1',
  clientId: 'cl1',
  invoiceNumber: 'INV-000042',
  postingStatus: 'POSTED',
  documentStatus: 'SENT',
  currencyCode: 'USD',
  totalAmount: '12500.00',
  outstandingAmount: '4500.00',
  dueDate: new Date('2026-10-15T00:00:00Z'),
  billingAddressSnapshot: { client: { name: 'Hodan Construction Ltd' }, org: { name: 'ACCO Ltd' } },
  ...over,
});

const message = (over: Partial<OutboundMessageView> = {}): OutboundMessageView => ({
  id: 'm1',
  channel: 'WHATSAPP',
  purpose: 'PAYMENT_REMINDER',
  clientId: 'cl1',
  recipient: '+252615555555',
  resourceType: CLIENT_INVOICE_REMINDER_RESOURCE,
  resourceId: 'inv1',
  templateName: 'rukna_payment_reminder',
  templateLanguage: 'en',
  status: 'SENT',
  queuedAt: '2026-10-03T09:00:00.000Z',
  sentAt: '2026-10-03T09:00:01.000Z',
  deliveredAt: null,
  readAt: null,
  failedAt: null,
  errorCode: null,
  errorMessage: null,
  createdBy: 'u1',
  createdAt: '2026-10-03T09:00:00.000Z',
  ...over,
});

const ENV = {
  WHATSAPP_TEMPLATE_PAYMENT_REMINDER: 'rukna_payment_reminder',
  WHATSAPP_TEMPLATE_OVERDUE_REMINDER: 'rukna_overdue_reminder',
};

function setup(
  opts: {
    env?: Record<string, string>;
    configured?: boolean;
    inv?: Record<string, unknown>;
    contacts?: unknown[];
    orgName?: string | null;
  } = {},
) {
  const env: Record<string, string> = opts.env ?? ENV;
  const repo = {
    findInvoice: jest.fn().mockResolvedValue(invoice(opts.inv)),
    findClientName: jest.fn().mockResolvedValue('Live Client'),
    findOrganizationName: jest
      .fn()
      .mockResolvedValue(opts.orgName === undefined ? 'Live Org' : opts.orgName),
    listContacts: jest.fn().mockResolvedValue(
      opts.contacts ?? [
        {
          id: 'k2',
          name: 'Hodan',
          role: 'Director',
          phone: null,
          whatsappPhone: '+252615555555',
          isPrimary: true,
        },
      ],
    ),
    recordReminderFollowUp: jest.fn().mockResolvedValue(true),
    voidReminderFollowUp: jest.fn().mockResolvedValue(1),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const communication = {
    registerStatusHooks: jest.fn(),
    sendWhatsAppTemplate: jest.fn().mockResolvedValue(message()),
    findForResourceByKey: jest.fn().mockResolvedValue(null),
  };
  const service = new InvoiceReminderWhatsAppService(
    { getClient: () => ({}) } as never,
    { get: (key: string) => env[key] } as never,
    { isConfigured: () => opts.configured ?? true } as never,
    communication as never,
    repo as never,
    audit as never,
  );
  return { service, repo, communication, audit };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
});
afterEach(() => jest.useRealTimers());

describe('reminder rules', () => {
  it('picks the overdue template only once the due date has passed (UTC calendar days)', () => {
    expect(reminderKind(new Date('2026-10-02T00:00:00Z'), NOW)).toBe('OVERDUE_REMINDER');
    expect(reminderKind(new Date('2026-10-03T00:00:00Z'), NOW)).toBe('PAYMENT_REMINDER');
    expect(reminderKind(new Date('2026-10-20T00:00:00Z'), NOW)).toBe('PAYMENT_REMINDER');
    expect(reminderKind(null, NOW)).toBe('PAYMENT_REMINDER');
    expect(reminderDaysPastDue(new Date('2026-09-23T00:00:00Z'), NOW)).toBe(10);
    expect(reminderDaysPastDue(new Date('2026-10-20T00:00:00Z'), NOW)).toBe(0);
  });

  it('reads the outstanding amount without floats', () => {
    expect(hasOutstanding('0.00')).toBe(false);
    expect(hasOutstanding('-5.00')).toBe(false);
    expect(hasOutstanding('0.01')).toBe(true);
    expect(hasOutstanding('4500.00')).toBe(true);
  });

  it('orders blockers: record first, then recipient, then set-up', () => {
    const ok = {
      issued: true,
      reversed: false,
      hasReference: true,
      outstanding: true,
      recipient: '+252615555555',
      templateConfigured: true,
      whatsappConfigured: true,
    };
    expect(reminderBlockedReason(ok)).toBeNull();
    expect(reminderBlockedReason({ ...ok, reversed: true, issued: false })).toBe('REVERSED');
    expect(reminderBlockedReason({ ...ok, issued: false, outstanding: false })).toBe('NOT_POSTED');
    expect(reminderBlockedReason({ ...ok, outstanding: false, recipient: null })).toBe(
      'NOTHING_OUTSTANDING',
    );
    expect(reminderBlockedReason({ ...ok, recipient: null, templateConfigured: false })).toBe(
      'NO_RECIPIENT',
    );
  });
});

describe('opening-balance invoices (migrated receivables)', () => {
  it('are remindable without a Rukna number; cancelled / unposted are not', () => {
    const base = { invoiceNumber: null, documentStatus: 'APPROVED' };
    expect(isRemindable({ ...base, postingStatus: 'OPENING_BALANCE' })).toBe(true);
    expect(isRemindable({ ...base, postingStatus: 'POSTED' })).toBe(false);
    expect(isRemindable({ ...base, postingStatus: 'NOT_POSTED', invoiceNumber: 'X' })).toBe(false);
    expect(
      isRemindable({ ...base, postingStatus: 'OPENING_BALANCE', documentStatus: 'CANCELLED' }),
    ).toBe(false);
  });

  it('quote the invoice number, else the prior system reference', () => {
    expect(reminderInvoiceReference({ invoiceNumber: 'INV-1', billingAddressSnapshot: {} })).toBe(
      'INV-1',
    );
    expect(
      reminderInvoiceReference({
        invoiceNumber: null,
        billingAddressSnapshot: { migratedFrom: 'QuickBooks', invoiceRef: ' QB-1042 ' },
      }),
    ).toBe('QB-1042');
    expect(reminderInvoiceReference({ invoiceNumber: null, billingAddressSnapshot: null })).toBeNull();
  });

  it('preview: an opening-balance invoice is sendable and names its QuickBooks reference', async () => {
    const { service } = setup({
      inv: {
        invoiceNumber: null,
        postingStatus: 'OPENING_BALANCE',
        dueDate: new Date('2026-06-30T00:00:00Z'),
        billingAddressSnapshot: { migratedFrom: 'QuickBooks', invoiceRef: 'QB-1042' },
      },
    });
    const preview = await service.preview(identity, 'inv1');
    expect(preview).toMatchObject({ sendable: true, kind: 'OVERDUE_REMINDER' });
    expect(preview.message).toContain('invoice QB-1042 from Live Org for USD 4,500.00');
  });

  it('refuses one with no number and no reference (NO_INVOICE_REFERENCE, not NOT_POSTED)', async () => {
    const { service, communication } = setup({
      inv: { invoiceNumber: null, postingStatus: 'OPENING_BALANCE', billingAddressSnapshot: {} },
    });
    expect((await service.preview(identity, 'inv1')).blockedReason).toBe('NO_INVOICE_REFERENCE');
    const error = await service
      .send(identity, 'inv1', { idempotencyKey: 'k' })
      .catch((e: unknown) => e);
    expect((error as { getStatus(): number }).getStatus()).toBe(409);
    expect(communication.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('with no due date: a payment reminder, 0 days past due, "due on receipt"', async () => {
    const { service } = setup({
      inv: {
        invoiceNumber: null,
        postingStatus: 'OPENING_BALANCE',
        dueDate: null,
        billingAddressSnapshot: { invoiceRef: 'QB-7' },
      },
    });
    const preview = await service.preview(identity, 'inv1');
    expect(preview).toMatchObject({ kind: 'PAYMENT_REMINDER', daysPastDue: 0 });
    expect(preview.message).toContain('is due on receipt.');
  });
});

describe('InvoiceReminderWhatsAppService.preview', () => {
  it('a not-yet-due invoice gets the payment reminder naming the OUTSTANDING amount, no attachment', async () => {
    const { service } = setup();
    const preview = await service.preview(identity, 'inv1');
    expect(preview).toMatchObject({
      kind: 'PAYMENT_REMINDER',
      outstandingAmount: '4500.00',
      currencyCode: 'USD',
      daysPastDue: 0,
      filename: null,
      defaultRecipient: '+252615555555',
      sendable: true,
      blockedReason: null,
    });
    expect(preview.message).toBe(
      'Hello Hodan Construction Ltd, this is a reminder from ACCO Ltd that invoice INV-000042 for USD 4,500.00 is due on 15 Oct 2026. If you have already paid, please ignore this message. Thank you.',
    );
  });

  it('an invoice past its due date gets the overdue reminder', async () => {
    const { service } = setup({ inv: { dueDate: new Date('2026-09-30T00:00:00Z') } });
    const preview = await service.preview(identity, 'inv1');
    expect(preview.kind).toBe('OVERDUE_REMINDER');
    expect(preview.daysPastDue).toBe(3);
    expect(preview.message).toContain('was due on 30 Sep 2026 and is now overdue');
  });

  it.each([
    [{ inv: { outstandingAmount: '0.00', documentStatus: 'PAID' } }, 'NOTHING_OUTSTANDING'],
    [{ inv: { postingStatus: 'NOT_POSTED', invoiceNumber: null } }, 'NOT_POSTED'],
    [{ inv: { postingStatus: 'REVERSED' } }, 'REVERSED'],
    [{ inv: { documentStatus: 'CANCELLED' } }, 'NOT_POSTED'],
    [{ contacts: [] }, 'NO_RECIPIENT'],
    [{ env: { WHATSAPP_TEMPLATE_OVERDUE_REMINDER: 'x' } }, 'TEMPLATE_NOT_CONFIGURED'],
    [{ configured: false }, 'WHATSAPP_NOT_CONFIGURED'],
  ])('explains a blocked reminder (%o → %s)', async (opts, reason) => {
    const { service } = setup(opts);
    const preview = await service.preview(identity, 'inv1');
    expect(preview.sendable).toBe(false);
    expect(preview.blockedReason).toBe(reason);
  });

  it('checks the template of the kind it would send', async () => {
    const { service } = setup({
      env: { WHATSAPP_TEMPLATE_PAYMENT_REMINDER: 'x' },
      inv: { dueDate: new Date('2026-09-01T00:00:00Z') },
    });
    expect((await service.preview(identity, 'inv1')).blockedReason).toBe('TEMPLATE_NOT_CONFIGURED');
  });
});

describe('InvoiceReminderWhatsAppService.send', () => {
  it('a replay returns the original message before any refusal check (the invoice was paid since)', async () => {
    const { service, communication, repo } = setup({ inv: { outstandingAmount: '0.00' } });
    const original = message({ id: 'm-original', status: 'DELIVERED' });
    communication.findForResourceByKey.mockResolvedValue(original);
    await expect(service.send(identity, 'inv1', { idempotencyKey: 'k' })).resolves.toBe(original);
    expect(communication.findForResourceByKey).toHaveBeenCalledWith(
      identity,
      'invoice-reminder:inv1:k',
      'client_invoice_reminder',
      'inv1',
    );
    expect(repo.findInvoice).not.toHaveBeenCalled();
    expect(communication.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('a FAILED earlier attempt is re-checked (paid now → refused, nothing re-sent)', async () => {
    const { service, communication } = setup({ inv: { outstandingAmount: '0.00' } });
    communication.findForResourceByKey.mockResolvedValue(message({ status: 'FAILED' }));
    await expect(service.send(identity, 'inv1', { idempotencyKey: 'k' })).rejects.toMatchObject({
      status: 409,
    });
    expect(communication.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('sends a text-only template through CommunicationService in the reminder namespace', async () => {
    const { service, communication } = setup({
      inv: { dueDate: new Date('2026-09-30T00:00:00Z') },
    });
    await service.send(identity, 'inv1', { idempotencyKey: ' k-1 ' });
    const call = communication.sendWhatsAppTemplate.mock.calls[0][1];
    expect(call).toMatchObject({
      purpose: 'OVERDUE_REMINDER',
      clientId: 'cl1',
      recipient: '+252615555555',
      resourceType: 'client_invoice_reminder',
      resourceId: 'inv1',
      templateName: 'rukna_overdue_reminder',
      language: 'en',
      bodyParams: [
        'Hodan Construction Ltd',
        'INV-000042',
        'USD 4,500.00',
        '30 Sep 2026',
        'ACCO Ltd',
      ],
      idempotencyKey: 'invoice-reminder:inv1:k-1',
    });
    expect(call.document).toBeUndefined();
  });

  it('a repeat with the same key asks CommunicationService with the same key (it returns the same message)', async () => {
    const { service, communication } = setup();
    const first = await service.send(identity, 'inv1', { idempotencyKey: 'k' });
    const second = await service.send(identity, 'inv1', { idempotencyKey: 'k' });
    expect(second).toEqual(first);
    const keys = communication.sendWhatsAppTemplate.mock.calls.map((c) => c[1].idempotencyKey);
    expect(keys).toEqual(['invoice-reminder:inv1:k', 'invoice-reminder:inv1:k']);
  });

  it('uses a typed number over the default', async () => {
    const { service, communication } = setup();
    await service.send(identity, 'inv1', { recipient: '+252612345678', idempotencyKey: 'k' });
    expect(communication.sendWhatsAppTemplate.mock.calls[0][1].recipient).toBe('+252612345678');
  });

  it.each([
    [{ inv: { outstandingAmount: '0.00' } }, {}, 409, 'NOTHING_OUTSTANDING'],
    [{ inv: { postingStatus: 'NOT_POSTED', invoiceNumber: null } }, {}, 409, 'NOT_POSTED'],
    [{ inv: { postingStatus: 'REVERSED' } }, {}, 409, 'REVERSED'],
    [{}, { recipient: '12345' }, 400, 'RECIPIENT_INVALID'],
    [{ contacts: [] }, {}, 400, 'NO_RECIPIENT'],
    [{ env: {} }, {}, 400, 'TEMPLATE_NOT_CONFIGURED'],
    [{ orgName: null, inv: { billingAddressSnapshot: {} } }, {}, 400, 'COMPANY_NAME_MISSING'],
  ])('refuses %o %o with %s %s and sends nothing', async (opts, body, status, code) => {
    const { service, communication } = setup(opts);
    const error = await service
      .send(identity, 'inv1', { idempotencyKey: 'k', ...body })
      .catch((e: unknown) => e);
    expect((error as { getStatus(): number }).getStatus()).toBe(status);
    expect((error as { getResponse(): { errorCode: string } }).getResponse().errorCode).toBe(code);
    expect(communication.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('404s an invoice of another organisation', async () => {
    const { service, repo } = setup();
    repo.findInvoice.mockResolvedValue(null);
    await expect(service.send(identity, 'inv1', { idempotencyKey: 'k' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('InvoiceReminderWhatsAppService status hooks', () => {
  function hooks() {
    const ctx = setup();
    ctx.service.onModuleInit();
    expect(ctx.communication.registerStatusHooks).toHaveBeenCalledTimes(1);
    const [resourceType, registered] = ctx.communication.registerStatusHooks.mock.calls[0];
    expect(resourceType).toBe('client_invoice_reminder');
    return { ...ctx, registered };
  }
  const hookCtx = { organizationId: 'org1', actorUserId: 'u1' };

  it('onSent writes one WHATSAPP follow-up linked to the message, and audits it', async () => {
    const { registered, repo, audit } = hooks();
    const tx = {} as never;
    await registered.onSent(tx, hookCtx, message({ purpose: 'OVERDUE_REMINDER' }));
    expect(repo.recordReminderFollowUp).toHaveBeenCalledWith(tx, {
      organizationId: 'org1',
      invoiceId: 'inv1',
      note: 'Overdue reminder sent through Rukna on WhatsApp to +252615555555',
      occurredAt: new Date('2026-10-03T09:00:01.000Z'),
      recordedBy: 'u1',
      outboundMessageId: 'm1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'client-invoice.whatsapp-reminder-recorded',
        idempotencyKey: 'client-invoice.whatsapp-reminder-recorded:m1',
      }),
    );
  });

  it('a repeat onSent (already recorded) writes no second audit row', async () => {
    const { registered, repo, audit } = hooks();
    repo.recordReminderFollowUp.mockResolvedValue(false);
    await registered.onSent({} as never, hookCtx, message());
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('onFailed removes the follow-up that message recorded', async () => {
    const { registered, repo, audit } = hooks();
    await registered.onFailed({} as never, hookCtx, message({ status: 'FAILED' }));
    expect(repo.voidReminderFollowUp).toHaveBeenCalledWith({}, 'org1', 'm1');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});
