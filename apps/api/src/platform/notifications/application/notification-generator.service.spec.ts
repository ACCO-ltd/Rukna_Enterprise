// @nestjs/schedule@12 is pure ESM and cannot be parsed by the unit Jest config; a repo-wide
// moduleNameMapper redirects it to a CJS stub (apps/api/test/mocks/nestjs-schedule.stub.ts).
import { ConfigService } from '@nestjs/config';

import { NotificationGeneratorService } from './notification-generator.service.js';
import { NotificationRecipientService } from './notification-recipient.service.js';
import { StagePaymentSource, STAGE_PAYMENT_RESOURCE_TYPE } from './notification-sources/stage-payment.source.js';
import {
  ClientInvoiceOverdueSource,
  CLIENT_INVOICE_RESOURCE_TYPE,
} from './notification-sources/client-invoice-overdue.source.js';
import type { INotificationRepository } from '../domain/notification-repository.interface.js';

/**
 * Unit tests for the generator's orchestration (dedupe/resolve/recipient wiring) against a mocked
 * repository and a mocked tenant Prisma client. No DB — the `rukna_test` DB is not stood up here.
 */

const NOW = new Date('2026-09-15T06:00:00.000Z');
const ORG = 'org_1';

/** A due milestone stage on a live MILESTONE contract, due in 3 days (→ STAGE_PAYMENT_DUE). */
function dueStageInstallmentRow() {
  return {
    id: 'inst_due',
    name: 'Structure',
    dueDate: new Date(Date.UTC(2026, 8, 18)), // 2026-09-18, 3 days out
    contract: { id: 'contract_1', projectId: 'project_1', contractNumber: 'ACCO-001' },
  };
}

/** The SAME installment, now 5 days past due (→ STAGE_PAYMENT_OVERDUE, key stage-overdue:inst_due). */
function overdueStageInstallmentRow() {
  return {
    id: 'inst_due',
    name: 'Structure',
    dueDate: new Date(Date.UTC(2026, 8, 10)), // 2026-09-10, 5 days past NOW
    contract: { id: 'contract_1', projectId: 'project_1', contractNumber: 'ACCO-001' },
  };
}

/** An overdue invoice due 2026-08-01 → 45 days overdue vs NOW → bucket 30 (key invoice-overdue:inv_1:30). */
function overdueInvoiceRow() {
  return {
    id: 'inv_1',
    invoiceNumber: 'INV-0001',
    dueDate: new Date(Date.UTC(2026, 7, 1)),
    projectId: 'project_1',
    contractId: 'contract_1',
  };
}

function makeRepo(): jest.Mocked<INotificationRepository> {
  return {
    upsertByDedupeKey: jest.fn().mockResolvedValue(undefined),
    autoResolveMissing: jest.fn().mockResolvedValue(0),
    findForRecipientPaged: jest.fn(),
    countUnread: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  } as unknown as jest.Mocked<INotificationRepository>;
}

/**
 * A tenant Prisma double. `installments` / `invoices` feed the two sources; `members` feed recipient
 * resolution; org bypass-role holders default to none.
 */
function makePrisma(opts: {
  installments?: ReturnType<typeof dueStageInstallmentRow>[];
  invoices?: unknown[];
  members?: { userId: string }[];
}) {
  return {
    contractPaymentInstallment: {
      findMany: jest.fn().mockResolvedValue(opts.installments ?? []),
    },
    clientInvoice: {
      findMany: jest.fn().mockResolvedValue(opts.invoices ?? []),
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue(opts.members ?? []),
    },
    organizationMembership: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as import('@prisma/client').PrismaClient;
}

function makeGenerator(repo: INotificationRepository) {
  const platformPrisma = {} as never;
  const tenancy = {} as never;
  const config = { get: jest.fn().mockReturnValue('true') } as unknown as ConfigService;
  return new NotificationGeneratorService(
    platformPrisma,
    tenancy,
    config,
    new NotificationRecipientService(),
    new StagePaymentSource(),
    new ClientInvoiceOverdueSource(),
    repo,
  );
}

/** Reach the private per-org cycle directly so we exercise the orchestration without the tenant walk. */
function runOrgCycle(
  generator: NotificationGeneratorService,
  prisma: import('@prisma/client').PrismaClient,
) {
  return (
    generator as unknown as {
      runOrgCycle: (
        p: import('@prisma/client').PrismaClient,
        orgId: string,
        now: Date,
      ) => Promise<void>;
    }
  ).runOrgCycle(prisma, ORG, NOW);
}

describe('NotificationGeneratorService.runOrgCycle', () => {
  it('upserts one row per recipient for a live due stage; a second run upserts the same key again (idempotent by repo)', async () => {
    const repo = makeRepo();
    const generator = makeGenerator(repo);
    const prisma = makePrisma({ installments: [dueStageInstallmentRow()], members: [{ userId: 'u1' }] });

    await runOrgCycle(generator, prisma);
    await runOrgCycle(generator, prisma);

    // One live condition × one recipient × two runs = two upsert calls, all on the SAME dedupe key.
    const stageUpserts = repo.upsertByDedupeKey.mock.calls.filter(
      ([data]) => data.resourceType === STAGE_PAYMENT_RESOURCE_TYPE,
    );
    expect(stageUpserts).toHaveLength(2);
    expect(stageUpserts[0][0].dedupeKey).toBe('stage-due:inst_due');
    expect(stageUpserts[1][0].dedupeKey).toBe('stage-due:inst_due');
    expect(stageUpserts[0][0]).toMatchObject({
      organizationId: ORG,
      recipientUserId: 'u1',
      kind: 'STAGE_PAYMENT_DUE',
      severity: 'WARNING',
      projectId: 'project_1',
      contractId: 'contract_1',
      resourceId: 'inst_due',
      actionUrl: '/projects/project_1/commercial/payment-schedule',
      contextData: { stageName: 'Structure', contractNumber: 'ACCO-001', dueInDays: 3 },
    });
  });

  it('auto-resolves with the live resource set: a billed stage (no live conditions) is passed an empty live list', async () => {
    const repo = makeRepo();
    const generator = makeGenerator(repo);
    // No installments come back (the stage got billed → clientInvoice non-null → excluded by the query).
    const prisma = makePrisma({ installments: [], invoices: [], members: [{ userId: 'u1' }] });

    await runOrgCycle(generator, prisma);

    expect(repo.autoResolveMissing).toHaveBeenCalledWith(ORG, STAGE_PAYMENT_RESOURCE_TYPE, []);
    expect(repo.autoResolveMissing).toHaveBeenCalledWith(ORG, CLIENT_INVOICE_RESOURCE_TYPE, []);
    // No live conditions → nothing generated.
    expect(repo.upsertByDedupeKey).not.toHaveBeenCalled();
  });

  it('passes the live DEDUPE KEY (not the resourceId) to autoResolveMissing for a live stage', async () => {
    const repo = makeRepo();
    const generator = makeGenerator(repo);
    const prisma = makePrisma({ installments: [dueStageInstallmentRow()], members: [{ userId: 'u1' }] });

    await runOrgCycle(generator, prisma);

    // Resolve keys on the dedupeKey so a stale key for this installment (e.g. a prior stage-overdue)
    // is closed while the live stage-due row is kept — resolving by resourceId could not do this.
    expect(repo.autoResolveMissing).toHaveBeenCalledWith(ORG, STAGE_PAYMENT_RESOURCE_TYPE, [
      'stage-due:inst_due',
    ]);
  });

  it('DUE→OVERDUE: only the overdue key is live, so the stale stage-due row is closed (no double alert)', async () => {
    const repo = makeRepo();
    const generator = makeGenerator(repo);
    const prisma = makePrisma({ installments: [overdueStageInstallmentRow()], members: [{ userId: 'u1' }] });

    await runOrgCycle(generator, prisma);

    // The prior `stage-due:inst_due` key is absent from the live set → the repo's notIn(dedupeKey)
    // closes it, leaving only the current overdue row (this is the H1 regression guard).
    expect(repo.autoResolveMissing).toHaveBeenCalledWith(ORG, STAGE_PAYMENT_RESOURCE_TYPE, [
      'stage-overdue:inst_due',
    ]);
    const stageUpserts = repo.upsertByDedupeKey.mock.calls.filter(
      ([data]) => data.resourceType === STAGE_PAYMENT_RESOURCE_TYPE,
    );
    expect(stageUpserts).toHaveLength(1);
    expect(stageUpserts[0][0]).toMatchObject({
      kind: 'STAGE_PAYMENT_OVERDUE',
      dedupeKey: 'stage-overdue:inst_due',
    });
  });

  it('aging invoice: resolves on the CURRENT band key, so a superseded band row is closed', async () => {
    const repo = makeRepo();
    const generator = makeGenerator(repo);
    const prisma = makePrisma({ invoices: [overdueInvoiceRow()], members: [{ userId: 'u1' }] });

    await runOrgCycle(generator, prisma);

    // 45 days overdue → band 30. Only :30 is live; a prior :1 band row is not in the set and is closed.
    expect(repo.autoResolveMissing).toHaveBeenCalledWith(ORG, CLIENT_INVOICE_RESOURCE_TYPE, [
      'invoice-overdue:inv_1:30',
    ]);
    const invoiceUpserts = repo.upsertByDedupeKey.mock.calls.filter(
      ([data]) => data.resourceType === CLIENT_INVOICE_RESOURCE_TYPE,
    );
    expect(invoiceUpserts).toHaveLength(1);
    expect(invoiceUpserts[0][0].dedupeKey).toBe('invoice-overdue:inv_1:30');
  });

  it('skips generation when a project-scoped condition has no recipients (under-notify, do not crash)', async () => {
    const repo = makeRepo();
    const generator = makeGenerator(repo);
    const prisma = makePrisma({ installments: [dueStageInstallmentRow()], members: [] });

    await runOrgCycle(generator, prisma);

    // Auto-resolve still ran; nothing was generated because the audience is empty.
    expect(repo.autoResolveMissing).toHaveBeenCalled();
    expect(repo.upsertByDedupeKey).not.toHaveBeenCalled();
  });
});
