/**
 * Material request approval (ADR-011 seam on submit, ADR-022 requester ≠ approver on approve).
 * Real DB, real CommandGovernanceService and SegregationOfDutiesService.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, WorkflowTransactionType, type RequestIdentity } from '@erp/types';
import { REQUIRED_PERMISSIONS_KEY } from '../../../common/decorators/require-permissions.decorator.js';
import { MaterialRequestController } from '../material-requests/presentation/material-request.controller.js';
import { MaterialRequestService, estimatedTotal, todayDateOnly } from '../material-requests/application/material-request.service.js';
import { MaterialRequestRepository } from '../material-requests/infrastructure/material-request.repository.js';
import { MaterialRepository } from '../catalogue/infrastructure/material.repository.js';
import { UomRepository } from '../catalogue/infrastructure/uom.repository.js';
import { ProjectAccessService } from '../../../platform/project-access/project-access.service.js';
import { SegregationOfDutiesService } from '../../../platform/workflows/application/segregation-of-duties.service.js';
import { CommandGovernanceService } from '../../../platform/workflows/application/command-governance.service.js';
import { WorkflowTriggerResolverService } from '../../../platform/workflows/application/workflow-trigger-resolver.service.js';
import { WorkflowsPrismaRepository } from '../../../platform/workflows/infrastructure/workflows-prisma.repository.js';
import type { TenancyService } from '../../../platform/tenancy/tenancy.service.js';
import { ProcurementFixtureFactory, type ProcurementTestEnv } from './helpers/procurement-fixture.factory.js';
import {
  activateSodRules,
  addTransitionBinding,
  approveInstance,
  cleanupGovernance,
} from './helpers/governance-fixture.js';

const prisma = new PrismaClient();
let env: ProcurementTestEnv;
let svc: MaterialRequestService;
let approver: RequestIdentity;

async function draftMr(estimatedUnitPrice?: number) {
  return svc.create(env.identity, {
    requestScope: 'PROJECT',
    projectId: env.projectId,
    currencyCode: estimatedUnitPrice !== undefined ? 'USD' : undefined,
    lines: [
      {
        lineType: 'MATERIAL',
        materialCode: 'REBAR-12',
        description: '12mm Rebar',
        uomCode: 'TON',
        requestedQuantity: 4,
        estimatedUnitPrice,
        boqNodeId: env.boqNodeId,
      },
    ],
  });
}

async function status(id: string) {
  return (await prisma.materialRequest.findUniqueOrThrow({ where: { id } })).status;
}

beforeAll(async () => {
  env = await ProcurementFixtureFactory.create(prisma);
  const approverId = `${env.orgId}-approver`;
  await prisma.user.create({
    data: {
      id: approverId,
      organizationId: env.orgId,
      email: `${approverId}@example.test`,
      passwordHash: 'x',
      firstName: 'Mr',
      lastName: 'Approver',
      status: 'ACTIVE',
    },
  });
  await prisma.projectMember.create({ data: { projectId: env.projectId, userId: approverId, joinedBy: approverId } });
  approver = { ...env.identity, userId: approverId };

  await activateSodRules(prisma, env.orgId, ['REQUESTER_CANNOT_APPROVE_OWN_REQUEST']);

  const tenancy = { getClient: () => prisma } as unknown as TenancyService;
  svc = new MaterialRequestService(
    tenancy,
    new MaterialRequestRepository(),
    new MaterialRepository(),
    new UomRepository(),
    new ProjectAccessService(tenancy),
    { record: async () => undefined } as never,
    new SegregationOfDutiesService(tenancy),
    new CommandGovernanceService(new WorkflowTriggerResolverService(tenancy), new WorkflowsPrismaRepository(tenancy)),
  );
});

afterAll(async () => {
  await cleanupGovernance(prisma, env.orgId);
  await ProcurementFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

describe('MR approve / reject endpoints', () => {
  it('approve and reject require approve:material-request', () => {
    for (const handler of ['approve', 'reject'] as const) {
      expect(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, MaterialRequestController.prototype[handler]),
      ).toEqual([PERMISSIONS.materialRequestsApprove]);
    }
  });
});

describe('MR approval — no governance binding', () => {
  it('submit → SUBMITTED; the requester cannot approve; a different person can', async () => {
    const mr = await draftMr();
    await svc.submit(env.identity, mr.id);
    expect(await status(mr.id)).toBe('SUBMITTED');

    await expect(svc.approve(env.identity, mr.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await status(mr.id)).toBe('SUBMITTED');

    const approved = await svc.approve(approver, mr.id);
    expect(await status(mr.id)).toBe('APPROVED');
    expect(approved.lines.every((l) => l.approvedQuantity?.toString() === '4')).toBe(true);

    // Each line is approved for what was requested, in the same write.
    const lines = await prisma.materialRequestLine.findMany({ where: { materialRequestId: mr.id } });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.approvedQuantity?.toString()).toBe(line.requestedQuantity.toString());
    }

    // Approving twice is a state conflict, not a second write.
    await expect(svc.approve(approver, mr.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reject sends a submitted request back to DRAFT and needs a reason; it can be resubmitted', async () => {
    const mr = await draftMr();
    await svc.submit(env.identity, mr.id);

    await expect(svc.reject(approver, mr.id, '  ')).rejects.toBeInstanceOf(BadRequestException);
    await svc.reject(approver, mr.id, 'Quantities do not match the drawing');
    expect(await status(mr.id)).toBe('DRAFT');

    // Rejecting a DRAFT is not allowed.
    await expect(svc.reject(approver, mr.id, 'again')).rejects.toBeInstanceOf(ConflictException);

    await svc.submit(env.identity, mr.id);
    expect(await status(mr.id)).toBe('SUBMITTED');
  });
});

describe('MR approval — MaterialRequest DRAFT→SUBMITTED binding', () => {
  beforeAll(async () => {
    await addTransitionBinding(prisma, env.orgId, {
      entityType: 'MaterialRequest',
      transactionType: WorkflowTransactionType.MATERIAL_REQUEST,
      fromState: 'DRAFT',
      toState: 'SUBMITTED',
    });
  });

  it('gates submit with 409 + approvalInstanceId; re-drive after approval submits and records the instance', async () => {
    const mr = await draftMr(250);

    let instanceId: string | undefined;
    await expect(
      svc.submit(env.identity, mr.id).catch((e: unknown) => {
        instanceId = (e as { response?: { details?: { approvalInstanceId?: string } } }).response?.details
          ?.approvalInstanceId;
        throw e;
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(instanceId).toBeTruthy();
    expect(await status(mr.id)).toBe('DRAFT');
    const inst = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceId! } });
    expect(inst.evaluatedAmount?.toString()).toBe('1000');

    await approveInstance(prisma, instanceId!, approver.userId);
    await svc.submit(env.identity, mr.id);
    const after = await prisma.materialRequest.findUniqueOrThrow({ where: { id: mr.id } });
    expect(after.status).toBe('SUBMITTED');
    expect(after.approvalInstanceId).toBe(instanceId);
  });

  it('cancelling a request closes its pending approval', async () => {
    const mr = await draftMr();
    let instanceId: string | undefined;
    await svc.submit(env.identity, mr.id).catch((e: unknown) => {
      instanceId = (e as { response?: { details?: { approvalInstanceId?: string } } }).response?.details
        ?.approvalInstanceId;
    });
    expect(instanceId).toBeTruthy();
    await svc.cancel(env.identity, mr.id);
    expect((await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instanceId! } })).status).toBe(
      'CANCELLED',
    );
  });
});

describe('estimatedTotal', () => {
  it('is null when no line is priced, else the sum over priced lines', () => {
    expect(estimatedTotal([{ requestedQuantity: 2, estimatedUnitPrice: null }])).toBeNull();
    expect(
      estimatedTotal([
        { requestedQuantity: 2, estimatedUnitPrice: 10 },
        { requestedQuantity: 3, estimatedUnitPrice: null },
      ])?.toString(),
    ).toBe('20');
  });
});

describe('MR requested date is server-set', () => {
  it('stamps today (date-only) when the client sends none', async () => {
    const before = todayDateOnly();
    const mr = await draftMr();
    const after = todayDateOnly();
    const stored = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: mr.id } })).requestedDate;
    expect([before.getTime(), after.getTime()]).toContain(stored.getTime());
  });

  it('ignores a client-sent requestedDate', async () => {
    const mr = await svc.create(env.identity, {
      requestScope: 'ORGANIZATION',
      requestedDate: '2001-01-01',
      lines: [{ lineType: 'MATERIAL', materialCode: 'REBAR-12', description: 'x', uomCode: 'TON', requestedQuantity: 1 }],
    });
    const stored = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: mr.id } })).requestedDate;
    expect(stored.toISOString().slice(0, 10)).not.toBe('2001-01-01');
    expect(stored.getTime()).toBe(todayDateOnly().getTime());
  });

  it('todayDateOnly is the UTC calendar day at midnight', () => {
    expect(todayDateOnly(new Date('2026-10-04T23:30:00Z')).toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  it('the create DTO accepts a request without requestedDate', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { CreateMaterialRequestDto } = await import(
      '../material-requests/presentation/dto/create-material-request.dto.js'
    );
    const dto = plainToInstance(CreateMaterialRequestDto, {
      requestScope: 'ORGANIZATION',
      lines: [{ lineType: 'MATERIAL', materialCode: 'M', description: 'x', uomCode: 'TON', requestedQuantity: 1 }],
    });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'requestedDate')).toBeUndefined();
  });
});
