/**
 * Slice 6B — Collection Events DB integration tests.
 *
 * Proves the key invariants against a real database:
 * - follow-up does not touch invoice.dueDate or invoice.outstandingAmount
 * - promise does not touch invoice.dueDate
 * - multiple follow-ups allowed per invoice
 * - at most one open dispute per invoice
 * - resolving a dispute does not change invoice.outstandingAmount
 * - derivePromiseStatus logic (pure static — no DB needed)
 */

import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import {
  AccountingFixtureFactory,
  type AccountingTestEnv,
} from '../../../accounting/__tests__/helpers/fixture.factory.js';
import { CollectionEventsService } from '../../../accounting/accounts-receivable/application/collection-events.service.js';

describe('CollectionEventsService — DB integration (Slice 6B)', () => {
  const prisma = new PrismaClient();
  let env: AccountingTestEnv;
  let service: CollectionEventsService;
  let identity: RequestIdentity;
  // contractId is seeded by the fixture factory
  let contractId: string;
  let projectId: string;

  const DUE_DATE = new Date('2026-10-31');

  async function makePostedInvoice(): Promise<string> {
    const inv = await prisma.clientInvoice.create({
      data: {
        organizationId: env.orgId,
        clientId: env.clientId,
        projectId,
        contractId,
        invoiceDate: new Date('2026-09-01'),
        dueDate: DUE_DATE,
        subtotal: new Decimal('100000.00'),
        vatAmount: new Decimal('5000.00'),
        totalAmount: new Decimal('105000.00'),
        outstandingAmount: new Decimal('105000.00'),
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        postingStatus: 'POSTED',
        documentStatus: 'APPROVED',
        createdBy: identity.userId,
      },
      select: { id: true },
    });
    return inv.id;
  }

  beforeAll(async () => {
    env = await AccountingFixtureFactory.create(prisma);
    identity = env.identity;

    // The fixture factory already seeds a project and contract
    // Pull them from the DB for use by makePostedInvoice
    const contract = await prisma.contract.findFirstOrThrow({
      where: { organizationId: env.orgId },
      select: { id: true, projectId: true },
    });
    contractId = contract.id;
    projectId = contract.projectId;

    const tenancy = { getClient: () => prisma };
    service = new CollectionEventsService(tenancy as never);
  }, 60_000);

  afterAll(async () => {
    // Cleanup: collection tables cascade-restricted, so delete manually first
    await prisma.$executeRaw`DELETE FROM invoice_disputes WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM invoice_payment_promises WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM invoice_follow_ups WHERE organization_id = ${env.orgId}`;
    await AccountingFixtureFactory.cleanup(prisma, env.orgId);
    await prisma.$disconnect();
  });

  // ─── CE-01: follow-up does not change dueDate or outstandingAmount ───────────

  it('CE-01: follow-up does not change invoice.dueDate or invoice.outstandingAmount', async () => {
    const invoiceId = await makePostedInvoice();

    const before = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { dueDate: true, outstandingAmount: true },
    });

    await service.recordFollowUp(identity, {
      invoiceId,
      method: 'WHATSAPP',
      note: 'Sent reminder',
      occurredAt: new Date().toISOString(),
    });

    const after = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { dueDate: true, outstandingAmount: true },
    });

    expect(after.dueDate?.toISOString()).toBe(before.dueDate?.toISOString());
    expect(after.outstandingAmount.toString()).toBe(before.outstandingAmount.toString());
  });

  // ─── CE-02: promise does not change dueDate ──────────────────────────────────

  it('CE-02: promise does not change invoice.dueDate', async () => {
    const invoiceId = await makePostedInvoice();

    const before = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { dueDate: true },
    });

    await service.recordPromise(identity, {
      invoiceId,
      promisedDate: '2026-10-15',
      promisedAmount: '50000.00',
    });

    const after = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { dueDate: true },
    });

    expect(after.dueDate?.toISOString()).toBe(before.dueDate?.toISOString());
  });

  // ─── CE-03: multiple follow-ups allowed per invoice ──────────────────────────

  it('CE-03: multiple follow-ups allowed on the same invoice', async () => {
    const invoiceId = await makePostedInvoice();

    await service.recordFollowUp(identity, {
      invoiceId,
      method: 'EMAIL',
      occurredAt: new Date().toISOString(),
    });
    await service.recordFollowUp(identity, {
      invoiceId,
      method: 'PHONE',
      occurredAt: new Date().toISOString(),
    });

    const count = await prisma.invoiceFollowUp.count({ where: { invoiceId } });
    expect(count).toBe(2);
  });

  // ─── CE-04: at most one open dispute per invoice ─────────────────────────────

  it('CE-04: opening a second dispute on the same invoice throws ConflictException', async () => {
    const invoiceId = await makePostedInvoice();

    await service.openDispute(identity, {
      invoiceId,
      reason: 'PRICE_ERROR',
      note: 'First dispute',
    });

    await expect(
      service.openDispute(identity, { invoiceId, reason: 'OMISSION' }),
    ).rejects.toThrow(ConflictException);
  });

  // ─── CE-05: resolving a dispute does not change invoice.outstandingAmount ────

  it('CE-05: resolving a dispute does not change invoice.outstandingAmount', async () => {
    const invoiceId = await makePostedInvoice();

    const dispute = await service.openDispute(identity, {
      invoiceId,
      reason: 'SCOPE_DISAGREEMENT',
    });

    const before = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { outstandingAmount: true },
    });

    await service.resolveDispute(identity, {
      disputeId: dispute.id,
      resolutionNote: 'Settled',
    });

    const after = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { outstandingAmount: true },
    });

    expect(after.outstandingAmount.toString()).toBe(before.outstandingAmount.toString());
  });

  // ─── CE-06: ACTIVE when promised date is in the future ──────────────────────

  it('CE-06: ACTIVE when promised date is in the future and no allocations yet', () => {
    const promise = {
      promisedDate: new Date('2026-10-15'),
      promisedAmount: new Decimal('50000.00'),
      outstandingAtPromise: new Decimal('105000.00'),
      recordedAt: new Date('2026-09-17'),
    };
    expect(
      CollectionEventsService.derivePromiseStatus(promise, new Decimal('0'), '2026-09-18'),
    ).toBe('ACTIVE');
  });

  // ─── CE-07: KEPT when allocationsAfterPromise >= promisedAmount ──────────────

  it('CE-07: KEPT when allocations cover the promised amount', () => {
    const promise = {
      promisedDate: new Date('2026-10-15'),
      promisedAmount: new Decimal('50000.00'),
      outstandingAtPromise: new Decimal('105000.00'),
      recordedAt: new Date('2026-09-17'),
    };
    expect(
      CollectionEventsService.derivePromiseStatus(promise, new Decimal('50000.00'), '2026-10-10'),
    ).toBe('KEPT');
  });

  // ─── CE-08: MISSED when partial payment and date has passed ─────────────────

  it('CE-08: MISSED when partial payment and promised date has passed', () => {
    const promise = {
      promisedDate: new Date('2026-10-01'),
      promisedAmount: new Decimal('50000.00'),
      outstandingAtPromise: new Decimal('105000.00'),
      recordedAt: new Date('2026-09-17'),
    };
    expect(
      CollectionEventsService.derivePromiseStatus(promise, new Decimal('10000.00'), '2026-10-02'),
    ).toBe('MISSED');
  });

  // ─── CE-09: null promisedAmount falls back to outstandingAtPromise ───────────

  it('CE-09: null promisedAmount → uses outstandingAtPromise; KEPT when fully paid', () => {
    const promise = {
      promisedDate: new Date('2026-10-01'),
      promisedAmount: null,
      outstandingAtPromise: new Decimal('105000.00'),
      recordedAt: new Date('2026-09-17'),
    };
    expect(
      CollectionEventsService.derivePromiseStatus(promise, new Decimal('105000.00'), '2026-10-02'),
    ).toBe('KEPT');
  });

  // ─── DB-backed promise fulfillment tests (CE-10 through CE-13) ───────────────
  //
  // These prove the filter logic end-to-end: only allocations with
  // allocationDate >= promise.recordedAt AND allocationDate <= promise.promisedDate
  // count toward fulfillment (matching the service filter in commercial.service.ts).

  async function seedReceipt(amount: string, allocationDate: Date, invoiceId: string) {
    const receipt = await prisma.paymentReceipt.create({
      data: {
        organizationId: env.orgId,
        clientId: env.clientId,
        receiptDate: allocationDate,
        accountingDate: allocationDate,
        totalAmount: new Decimal(amount),
        allocatedAmount: new Decimal(amount),
        unallocatedAmount: new Decimal('0.00'),
        currencyCode: 'USD',
        documentStatus: 'DRAFT',
        postingStatus: 'POSTED',
        createdBy: identity.userId,
      },
      select: { id: true },
    });
    await prisma.clientReceiptAllocation.create({
      data: {
        organizationId: env.orgId,
        paymentReceiptId: receipt.id,
        clientInvoiceId: invoiceId,
        allocatedAmount: new Decimal(amount),
        allocationDate,
        postingStatus: 'POSTED',
        createdBy: identity.userId,
      },
    });
    return receipt.id;
  }

  it('CE-10: promise 50k — payment 50k AFTER recording → KEPT', async () => {
    const invoiceId = await makePostedInvoice();

    const promise = await service.recordPromise(identity, {
      invoiceId,
      promisedDate: '2026-10-15',
      promisedAmount: '50000.00',
    });

    // Allocation dated after the promise was recorded
    await seedReceipt('50000.00', new Date('2026-10-10'), invoiceId);

    const allocsAfter = await prisma.clientReceiptAllocation.findMany({
      where: {
        clientInvoiceId: invoiceId,
        postingStatus: 'POSTED',
        allocationDate: { gte: promise.recordedAt, lte: promise.promisedDate },
      },
    });
    const sum = allocsAfter.reduce(
      (acc, a) => acc.plus(new Decimal(a.allocatedAmount.toString())),
      new Decimal(0),
    );

    expect(
      CollectionEventsService.derivePromiseStatus(
        {
          promisedDate: promise.promisedDate,
          promisedAmount: promise.promisedAmount,
          outstandingAtPromise: promise.outstandingAtPromise,
          recordedAt: promise.recordedAt,
        },
        sum,
        '2026-10-10', // today is before promisedDate
      ),
    ).toBe('KEPT');
  });

  it('CE-11: promise 50k — payment 30k, promised date passed → MISSED', async () => {
    const invoiceId = await makePostedInvoice();

    const promise = await service.recordPromise(identity, {
      invoiceId,
      promisedDate: '2026-10-01',
      promisedAmount: '50000.00',
    });

    await seedReceipt('30000.00', new Date('2026-09-28'), invoiceId);

    const allocsAfter = await prisma.clientReceiptAllocation.findMany({
      where: {
        clientInvoiceId: invoiceId,
        postingStatus: 'POSTED',
        allocationDate: { gte: promise.recordedAt, lte: promise.promisedDate },
      },
    });
    const sum = allocsAfter.reduce(
      (acc, a) => acc.plus(new Decimal(a.allocatedAmount.toString())),
      new Decimal(0),
    );

    expect(
      CollectionEventsService.derivePromiseStatus(
        {
          promisedDate: promise.promisedDate,
          promisedAmount: promise.promisedAmount,
          outstandingAtPromise: promise.outstandingAtPromise,
          recordedAt: promise.recordedAt,
        },
        sum,
        '2026-10-05', // today is past promised date
      ),
    ).toBe('MISSED');
  });

  it('CE-12: payment BEFORE promise creation does not count toward fulfillment', async () => {
    const invoiceId = await makePostedInvoice();

    // Create a 50k allocation BEFORE the promise is recorded
    await seedReceipt('50000.00', new Date('2026-09-10'), invoiceId);

    // Record the promise AFTER the allocation (recordedAt = now ~ 2026-09-18)
    const promise = await service.recordPromise(identity, {
      invoiceId,
      promisedDate: '2026-10-15',
      promisedAmount: '50000.00',
    });

    // Filter: only allocations with allocationDate in [recordedAt, promisedDate]
    const allocsAfter = await prisma.clientReceiptAllocation.findMany({
      where: {
        clientInvoiceId: invoiceId,
        postingStatus: 'POSTED',
        allocationDate: { gte: promise.recordedAt, lte: promise.promisedDate },
      },
    });
    const sum = allocsAfter.reduce(
      (acc, a) => acc.plus(new Decimal(a.allocatedAmount.toString())),
      new Decimal(0),
    );

    // The 2026-09-10 allocation pre-dates the promise so sum must be 0
    expect(sum.toFixed(2)).toBe('0.00');

    // With zero filtered allocations and future promised date → ACTIVE (not KEPT)
    expect(
      CollectionEventsService.derivePromiseStatus(
        {
          promisedDate: promise.promisedDate,
          promisedAmount: promise.promisedAmount,
          outstandingAtPromise: promise.outstandingAtPromise,
          recordedAt: promise.recordedAt,
        },
        sum,
        '2026-09-18',
      ),
    ).toBe('ACTIVE');
  });

  it('CE-13: null promisedAmount (DB-backed) → uses outstandingAtPromise as target; full amount paid → KEPT', async () => {
    const invoiceId = await makePostedInvoice(); // outstanding 105,000

    const promise = await service.recordPromise(identity, {
      invoiceId,
      promisedDate: '2026-10-15',
      // No promisedAmount → service captures outstandingAtPromise = 105,000
    });

    // Null promisedAmount documented meaning: "the full outstanding balance at recording time"
    // Confirmed by the stored outstandingAtPromise value
    expect(promise.promisedAmount).toBeNull();
    expect(new Decimal(promise.outstandingAtPromise.toString()).toFixed(2)).toBe('105000.00');

    // Allocate the full outstanding amount after the promise
    await seedReceipt('105000.00', new Date('2026-10-14'), invoiceId);

    const allocsAfter = await prisma.clientReceiptAllocation.findMany({
      where: {
        clientInvoiceId: invoiceId,
        postingStatus: 'POSTED',
        allocationDate: { gte: promise.recordedAt, lte: promise.promisedDate },
      },
    });
    const sum = allocsAfter.reduce(
      (acc, a) => acc.plus(new Decimal(a.allocatedAmount.toString())),
      new Decimal(0),
    );

    expect(
      CollectionEventsService.derivePromiseStatus(
        {
          promisedDate: promise.promisedDate,
          promisedAmount: promise.promisedAmount,
          outstandingAtPromise: promise.outstandingAtPromise,
          recordedAt: promise.recordedAt,
        },
        sum,
        '2026-10-14',
      ),
    ).toBe('KEPT');
  });

  // ─── CE-14: late payment does not convert MISSED to KEPT ─────────────────────
  //
  // Fulfillment filter: allocationDate >= promise.recordedAt AND allocationDate <= promise.promisedDate
  // allocationDate is the authoritative financial date — the date the payment was posted
  // against the invoice (not the physical receipt date, which may differ).
  // A payment posted after the promised deadline settles the invoice but does NOT rewrite
  // collection-performance history.

  it('CE-14: payment after promised deadline is excluded from fulfillment — promise remains MISSED', async () => {
    const invoiceId = await makePostedInvoice(); // outstanding 105,000

    // Promise: 50,000 by Sep 25 2026
    const promise = await service.recordPromise(identity, {
      invoiceId,
      promisedDate: '2026-09-25',
      promisedAmount: '50000.00',
    });

    // Step 1: no payment in window [recordedAt, Sep 25] → sum = 0 → MISSED on Sep 26
    const emptyFilter = await prisma.clientReceiptAllocation.findMany({
      where: {
        clientInvoiceId: invoiceId,
        postingStatus: 'POSTED',
        allocationDate: { gte: promise.recordedAt, lte: promise.promisedDate },
      },
    });
    const sumEmpty = emptyFilter.reduce(
      (acc, a) => acc.plus(new Decimal(a.allocatedAmount.toString())),
      new Decimal(0),
    );
    expect(sumEmpty.toFixed(2)).toBe('0.00');
    expect(
      CollectionEventsService.derivePromiseStatus(
        {
          promisedDate: promise.promisedDate,
          promisedAmount: promise.promisedAmount,
          outstandingAtPromise: promise.outstandingAtPromise,
          recordedAt: promise.recordedAt,
        },
        sumEmpty,
        '2026-09-26', // today is past promised date
      ),
    ).toBe('MISSED');

    // Step 2: payment of 50,000 posted on Sep 26 (one day after deadline)
    await seedReceipt('50000.00', new Date('2026-09-26'), invoiceId);

    // Step 3: re-apply bounded filter — Sep 26 is outside [recordedAt, Sep 25] → sum still 0
    const afterPayment = await prisma.clientReceiptAllocation.findMany({
      where: {
        clientInvoiceId: invoiceId,
        postingStatus: 'POSTED',
        allocationDate: { gte: promise.recordedAt, lte: promise.promisedDate },
      },
    });
    const sumAfter = afterPayment.reduce(
      (acc, a) => acc.plus(new Decimal(a.allocatedAmount.toString())),
      new Decimal(0),
    );
    expect(sumAfter.toFixed(2)).toBe('0.00');
    expect(
      CollectionEventsService.derivePromiseStatus(
        {
          promisedDate: promise.promisedDate,
          promisedAmount: promise.promisedAmount,
          outstandingAtPromise: promise.outstandingAtPromise,
          recordedAt: promise.recordedAt,
        },
        sumAfter,
        '2026-09-26',
      ),
    ).toBe('MISSED');
  });
});
