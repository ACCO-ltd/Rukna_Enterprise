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

  it('passes the live installment id to autoResolveMissing when a stage is still live', async () => {
    const repo = makeRepo();
    const generator = makeGenerator(repo);
    const prisma = makePrisma({ installments: [dueStageInstallmentRow()], members: [{ userId: 'u1' }] });

    await runOrgCycle(generator, prisma);

    expect(repo.autoResolveMissing).toHaveBeenCalledWith(ORG, STAGE_PAYMENT_RESOURCE_TYPE, ['inst_due']);
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
