import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { CollectionEventsService } from './collection-events.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

/** Builds a minimal mock Prisma client used by all tests. */
function buildPrisma(overrides: Partial<{
  invoice: unknown;
  followUp: unknown;
  promise: unknown;
  openDisputeCount: number;
  dispute: unknown;
  updatedDispute: unknown;
}> = {}) {
  const defaultInvoice = { id: 'inv-1', outstandingAmount: new Decimal('10500.00') };
  const invoiceReturnValue = Object.prototype.hasOwnProperty.call(overrides, 'invoice')
    ? overrides.invoice
    : defaultInvoice;
  return {
    clientInvoice: {
      findFirst: jest.fn().mockResolvedValue(invoiceReturnValue),
    },
    invoiceFollowUp: {
      create: jest.fn().mockResolvedValue(overrides.followUp ?? { id: 'fu-1' }),
    },
    invoicePaymentPromise: {
      create: jest.fn().mockResolvedValue(overrides.promise ?? { id: 'pr-1' }),
    },
    invoiceDispute: {
      count: jest.fn().mockResolvedValue(overrides.openDisputeCount ?? 0),
      create: jest.fn().mockResolvedValue(overrides.dispute ?? { id: 'dp-1', resolvedAt: null }),
      findFirst: jest.fn().mockResolvedValue(overrides.dispute ?? { id: 'dp-1', resolvedAt: null }),
      update: jest.fn().mockResolvedValue(overrides.updatedDispute ?? { id: 'dp-1', resolvedAt: new Date() }),
    },
  };
}

function buildService(prismaOverrides?: Parameters<typeof buildPrisma>[0]) {
  const prisma = buildPrisma(prismaOverrides);
  const tenancy = { getClient: () => prisma };
  const service = new CollectionEventsService(tenancy as never);
  return { service, prisma };
}

// ─── recordFollowUp ────────────────────────────────────────────────────────────

describe('recordFollowUp', () => {
  it('inserts a follow-up and returns it without touching the invoice', async () => {
    const { service, prisma } = buildService();
    const result = await service.recordFollowUp(identity, {
      invoiceId: 'inv-1',
      method: 'WHATSAPP',
      note: 'Called client.',
      occurredAt: '2026-09-17T10:00:00.000Z',
    });
    expect(result).toEqual({ id: 'fu-1' });
    expect(prisma.invoiceFollowUp.create).toHaveBeenCalledTimes(1);
    // Must not touch clientInvoice.update — only findFirst for existence check
    expect(prisma.clientInvoice.findFirst).toHaveBeenCalledTimes(1);
  });

  it('throws 404 when invoice not found', async () => {
    const { service } = buildService({ invoice: null });
    await expect(
      service.recordFollowUp(identity, {
        invoiceId: 'no-such',
        method: 'EMAIL',
        occurredAt: '2026-09-17T10:00:00.000Z',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('maps contactPerson and note correctly', async () => {
    const { service, prisma } = buildService();
    await service.recordFollowUp(identity, {
      invoiceId: 'inv-1',
      method: 'PHONE',
      contactPerson: 'Ahmed',
      note: 'Promised to pay.',
      occurredAt: '2026-09-17T10:00:00.000Z',
    });
    const createCall = prisma.invoiceFollowUp.create.mock.calls[0][0];
    expect(createCall.data.contactPerson).toBe('Ahmed');
    expect(createCall.data.note).toBe('Promised to pay.');
  });
});

// ─── recordPromise ─────────────────────────────────────────────────────────────

describe('recordPromise', () => {
  it('captures outstandingAtPromise from the invoice, does not touch dueDate', async () => {
    const { service, prisma } = buildService();
    await service.recordPromise(identity, {
      invoiceId: 'inv-1',
      promisedDate: '2026-10-01',
      promisedAmount: '5000.00',
    });
    const createCall = prisma.invoicePaymentPromise.create.mock.calls[0][0];
    expect(createCall.data.outstandingAtPromise.toString()).toBe('10500');
    // Must not contain dueDate at all
    expect(createCall.data).not.toHaveProperty('dueDate');
  });

  it('throws 404 when invoice not found', async () => {
    const { service } = buildService({ invoice: null });
    await expect(
      service.recordPromise(identity, { invoiceId: 'no-such', promisedDate: '2026-10-01' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('stores null promisedAmount when not provided', async () => {
    const { service, prisma } = buildService();
    await service.recordPromise(identity, { invoiceId: 'inv-1', promisedDate: '2026-10-01' });
    const createCall = prisma.invoicePaymentPromise.create.mock.calls[0][0];
    expect(createCall.data.promisedAmount).toBeNull();
  });
});

// ─── openDispute ──────────────────────────────────────────────────────────────

describe('openDispute', () => {
  it('creates a dispute when no open dispute exists', async () => {
    const { service, prisma } = buildService({ openDisputeCount: 0 });
    const result = await service.openDispute(identity, {
      invoiceId: 'inv-1',
      reason: 'PRICE_ERROR',
    });
    expect(result).toEqual({ id: 'dp-1', resolvedAt: null });
    expect(prisma.invoiceDispute.create).toHaveBeenCalledTimes(1);
  });

  it('throws ConflictException when there is already an open dispute', async () => {
    const { service } = buildService({ openDisputeCount: 1 });
    await expect(
      service.openDispute(identity, { invoiceId: 'inv-1', reason: 'OMISSION' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws 404 when invoice not found', async () => {
    const { service } = buildService({ invoice: null });
    await expect(
      service.openDispute(identity, { invoiceId: 'no-such', reason: 'OTHER' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not include any amount fields on the invoice update path', async () => {
    const { service, prisma } = buildService({ openDisputeCount: 0 });
    await service.openDispute(identity, { invoiceId: 'inv-1', reason: 'OMISSION' });
    // The only write must be invoiceDispute.create — no clientInvoice.update
    expect(prisma.invoiceDispute.create).toHaveBeenCalledTimes(1);
  });
});

// ─── resolveDispute ────────────────────────────────────────────────────────────

describe('resolveDispute', () => {
  it('sets resolvedAt and resolvedBy', async () => {
    const { service, prisma } = buildService({
      dispute: { id: 'dp-1', resolvedAt: null },
      updatedDispute: { id: 'dp-1', resolvedAt: new Date('2026-09-17') },
    });
    const result = await service.resolveDispute(identity, { disputeId: 'dp-1' });
    expect(result).toEqual({ id: 'dp-1', resolvedAt: new Date('2026-09-17') });
    const updateCall = prisma.invoiceDispute.update.mock.calls[0][0];
    expect(updateCall.data.resolvedBy).toBe('user-1');
    expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
  });

  it('throws ConflictException when dispute is already resolved', async () => {
    const { service } = buildService({
      dispute: { id: 'dp-1', resolvedAt: new Date('2026-09-10') },
    });
    await expect(service.resolveDispute(identity, { disputeId: 'dp-1' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws NotFoundException when dispute not found', async () => {
    const { service, prisma } = buildService();
    prisma.invoiceDispute.findFirst.mockResolvedValueOnce(null);
    await expect(service.resolveDispute(identity, { disputeId: 'no-such' })).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ─── derivePromiseStatus ───────────────────────────────────────────────────────

describe('CollectionEventsService.derivePromiseStatus', () => {
  const basePromise = {
    promisedDate: new Date('2026-10-01'),
    promisedAmount: new Decimal('5000.00'),
    outstandingAtPromise: new Decimal('10000.00'),
    recordedAt: new Date('2026-09-15'),
  };

  it('returns KEPT when allocations >= promisedAmount', () => {
    const status = CollectionEventsService.derivePromiseStatus(
      basePromise,
      new Decimal('5000.00'),
      '2026-09-20',
    );
    expect(status).toBe('KEPT');
  });

  it('returns KEPT when allocations exactly equal promisedAmount', () => {
    const status = CollectionEventsService.derivePromiseStatus(
      basePromise,
      new Decimal('5000.00'),
      '2026-09-30',
    );
    expect(status).toBe('KEPT');
  });

  it('returns KEPT when allocations > promisedAmount (overpaid)', () => {
    const status = CollectionEventsService.derivePromiseStatus(
      basePromise,
      new Decimal('6000.00'),
      '2026-09-30',
    );
    expect(status).toBe('KEPT');
  });

  it('returns ACTIVE when date not yet past and not yet paid', () => {
    const status = CollectionEventsService.derivePromiseStatus(
      basePromise,
      new Decimal('0'),
      '2026-09-20', // promisedDate 2026-10-01 is still ahead
    );
    expect(status).toBe('ACTIVE');
  });

  it('returns MISSED when date has passed and not paid', () => {
    const status = CollectionEventsService.derivePromiseStatus(
      basePromise,
      new Decimal('0'),
      '2026-10-02', // promisedDate 2026-10-01 is in the past
    );
    expect(status).toBe('MISSED');
  });

  it('returns MISSED on partial payment after promised date', () => {
    const status = CollectionEventsService.derivePromiseStatus(
      basePromise,
      new Decimal('1000.00'), // less than the 5000 promised
      '2026-10-02',
    );
    expect(status).toBe('MISSED');
  });

  it('uses outstandingAtPromise as target when promisedAmount is null', () => {
    const withoutAmount = { ...basePromise, promisedAmount: null };
    // Pay the full outstanding
    expect(
      CollectionEventsService.derivePromiseStatus(withoutAmount, new Decimal('10000.00'), '2026-10-02'),
    ).toBe('KEPT');
    // Pay less than outstanding after promised date
    expect(
      CollectionEventsService.derivePromiseStatus(withoutAmount, new Decimal('9999.99'), '2026-10-02'),
    ).toBe('MISSED');
  });
});
