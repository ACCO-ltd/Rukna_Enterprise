import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ContractStatus, ProjectCategory, ProjectStatus } from '@prisma/client';
import { PERMISSIONS, ProjectRole, type RequestIdentity } from '@erp/types';

import { ProjectService } from './project.service';

const identity = (permissions: string[]): RequestIdentity => ({
  userId: 'user-1',
  tenantSlug: 'acco',
  activeOrganizationId: 'org-1',
  roles: [],
  permissions,
});

const workspaceRecord = {
  id: 'project-1',
  organizationId: 'org-1',
  commercialModel: 'CLIENT_CONTRACT',
  startDate: new Date('2026-02-01T00:00:00.000Z'),
  expectedEndDate: new Date('2027-08-31T00:00:00.000Z'),
  suspensions: [],
  members: [
    {
      user: { id: 'user-1', firstName: 'Ahmed', lastName: 'Hassan' },
      roles: [{ role: 'PROJECT_MANAGER' }],
    },
    {
      user: { id: 'user-2', firstName: 'Asha', lastName: 'Ali' },
      roles: [{ role: 'SITE_ENGINEER' }],
    },
  ],
  boq: { id: 'boq-1', versions: [{ status: 'BASELINED' }] },
  contracts: [
    {
      id: 'contract-1',
      contractNumber: 'CTR-001',
      contractValue: '12500000.00',
      currency: 'USD',
      status: ContractStatus.ACTIVE,
      startDate: null,
      expectedEndDate: null,
    },
  ],
  status: ProjectStatus.DRAFT,
};

describe('ProjectService workspace summary', () => {
  const projectAccess = { assertMember: jest.fn() };
  const repo = {
    findWorkspaceSummary: jest.fn(),
    findRecentProjectActivity: jest.fn(),
  };
  const tenancy = { getClient: jest.fn(() => ({ marker: 'tenant-client' })) };
  const service = new ProjectService(
    tenancy as never,
    {} as never,
    repo as never,
    {} as never,
    projectAccess as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    projectAccess.assertMember.mockResolvedValue(undefined);
    repo.findWorkspaceSummary.mockResolvedValue(workspaceRecord);
    repo.findRecentProjectActivity.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'CREATE',
        sourceCommand: 'project.create',
        createdAt: new Date('2026-08-13T10:42:00.000Z'),
        user: { id: 'user-1', firstName: 'Ahmed', lastName: 'Hassan' },
      },
    ]);
  });

  it('returns authoritative setup and responsibility projections', async () => {
    const result = await service.getWorkspaceSummary(
      identity([PERMISSIONS.contractsView, PERMISSIONS.financialPositionView]),
      'project-1',
    );

    expect(projectAccess.assertMember).toHaveBeenCalledWith(expect.any(Object), 'project-1');
    expect(repo.findWorkspaceSummary).toHaveBeenCalledWith(
      { marker: 'tenant-client' },
      'org-1',
      'project-1',
    );
    expect(result.setup).toEqual({
      identityComplete: true,
      boqExists: true,
      boqBaselined: true,
      mainContractApplicable: true,
      mainContractExists: true,
      teamReady: true,
      completedSteps: 4,
      totalSteps: 4,
    });
    expect(result.responsibility).toEqual({
      projectManager: { id: 'user-1', name: 'Ahmed Hassan' },
      teamCount: 2,
    });
    expect(result.mainContract?.contractValue).toBe('12500000.00');
    expect(result.recentActivity[0]).toMatchObject({
      action: 'CREATE',
      actor: { name: 'Ahmed Hassan' },
    });
  });

  it('does not disclose main-contract details or value without their permissions', async () => {
    const noContractAccess = await service.getWorkspaceSummary(identity([]), 'project-1');
    expect(noContractAccess.mainContract).toBeNull();
    expect(noContractAccess.financialsVisible).toBe(false);

    const contractOnly = await service.getWorkspaceSummary(
      identity([PERMISSIONS.contractsView]),
      'project-1',
    );
    expect(contractOnly.mainContract).toMatchObject({
      id: 'contract-1',
      contractValue: null,
      currency: null,
    });
  });

  it('orders lifecycle-aware workspace guidance without deriving it in the frontend', async () => {
    repo.findWorkspaceSummary.mockResolvedValue({
      ...workspaceRecord,
      startDate: null,
      expectedEndDate: null,
      suspensions: [{ id: 'suspension-1' }],
      members: workspaceRecord.members.slice(0, 1),
      boq: { id: 'boq-1', versions: [{ status: 'DRAFT' }] },
      contracts: [],
    });

    const result = await service.getWorkspaceGuidance(identity([]), 'project-1');

    expect(result.map((item) => item.kind)).toEqual([
      'PROGRAMME_DATES_MISSING',
      'BOQ_BASELINE_REQUIRED',
      'DELIVERY_TEAM_INCOMPLETE',
      'MAIN_CONTRACT_BLOCKED',
    ]);
    expect(result[0].severity).toBe('WARNING');
    expect(result.at(-1)?.severity).toBe('INFO');
    expect(result.find((item) => item.kind === 'PROGRAMME_DATES_MISSING')?.actionUrl).toBeNull();

    const actionable = await service.getWorkspaceGuidance(
      identity([
        PERMISSIONS.projectsManage,
        PERMISSIONS.boqView,
        PERMISSIONS.contractsCreate,
        PERMISSIONS.projectMembersManage,
      ]),
      'project-1',
    );
    expect(actionable.find((item) => item.kind === 'PROGRAMME_DATES_MISSING')?.actionUrl).toBe(
      '/projects/project-1/edit',
    );
    expect(actionable.find((item) => item.kind === 'DELIVERY_TEAM_INCOMPLETE')?.actionUrl).toBe(
      '/projects/project-1/members',
    );
  });

  it('does not present draft setup guidance for a terminal project', async () => {
    repo.findWorkspaceSummary.mockResolvedValue({
      ...workspaceRecord,
      status: ProjectStatus.CLOSED,
      startDate: null,
      expectedEndDate: null,
      suspensions: [{ id: 'historical-suspension' }],
      members: workspaceRecord.members.slice(0, 1),
      boq: null,
      contracts: [],
    });

    await expect(service.getWorkspaceGuidance(identity([]), 'project-1')).resolves.toEqual([]);
  });
});

describe('ProjectService.getReadiness (ADR-019 CONST-PLC-009)', () => {
  const readinessRecord = {
    status: 'DRAFT',
    commercialModel: 'CLIENT_CONTRACT',
    startDate: new Date('2026-02-01'),
    expectedEndDate: new Date('2027-08-31'),
    clientId: 'client-1',
    client: { status: 'ACTIVE' },
    contracts: [{ status: 'ACTIVE', startDate: new Date('2026-02-01') }],
    boq: { versions: [{ status: 'BASELINED' }] },
    members: [{ id: 'm-1' }, { id: 'm-2' }],
  };

  function build(record: unknown = readinessRecord) {
    const repo = { findReadinessSnapshot: jest.fn().mockResolvedValue(record) };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const tenancy = { getClient: () => ({ marker: 'tenant-client' }) };
    const service = new ProjectService(
      tenancy as never,
      {} as never,
      repo as never,
      {} as never,
      projectAccess as never,
      {} as never,
    );
    return { service, repo, projectAccess };
  }

  it('asserts membership, loads the snapshot, and maps it to a ready start contract', async () => {
    const { service, repo, projectAccess } = build();
    const result = await service.getReadiness(identity([]), 'project-1', 'start');

    expect(projectAccess.assertMember).toHaveBeenCalledWith(expect.any(Object), 'project-1');
    expect(repo.findReadinessSnapshot).toHaveBeenCalledWith(
      { marker: 'tenant-client' },
      'org-1',
      'project-1',
    );
    expect(result).toMatchObject({ command: 'start', targetStatus: 'ACTIVE', ready: true });
  });

  it('reports a specific unmet MANDATORY condition rather than a bare boolean', async () => {
    const { service } = build({ ...readinessRecord, client: { status: 'INACTIVE' } });
    const result = await service.getReadiness(identity([]), 'project-1', 'start');
    expect(result.ready).toBe(false);
    expect(result.conditions.find((c) => c.code === 'CLIENT_ACTIVE')).toMatchObject({ satisfied: false });
  });

  it('rejects an unknown lifecycle command', async () => {
    const { service, repo } = build();
    await expect(service.getReadiness(identity([]), 'project-1', 'teleport')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.findReadinessSnapshot).not.toHaveBeenCalled();
  });

  it('404s when the project is not found', async () => {
    const { service } = build(null);
    await expect(service.getReadiness(identity([]), 'missing', 'start')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ProjectService.start / close (ADR-019 Phase B2)', () => {
  const readyStartSnapshot = {
    status: 'DRAFT',
    commercialModel: 'CLIENT_CONTRACT',
    startDate: new Date('2026-02-01'),
    expectedEndDate: new Date('2027-08-31'),
    clientId: 'client-1',
    client: { status: 'ACTIVE' },
    contracts: [{ status: 'ACTIVE', startDate: new Date('2026-02-01') }],
    boq: { versions: [{ status: 'BASELINED' }] },
    members: [{ id: 'm-1' }, { id: 'm-2' }],
  };

  function build(over: { project?: unknown; snapshot?: unknown; gated?: boolean } = {}) {
    const audit: unknown[] = [];
    const repo = {
      findById: jest.fn().mockResolvedValue(over.project ?? { id: 'project-1', status: 'DRAFT' }),
      findActiveSuspension: jest.fn().mockResolvedValue(null),
      findReadinessSnapshot: jest.fn().mockResolvedValue(over.snapshot ?? readyStartSnapshot),
      update: jest.fn().mockImplementation((_tx, _id, data) => ({ id: 'project-1', ...data })),
    };
    const commandGovernance = {
      gateStateTransition: jest
        .fn()
        .mockResolvedValue(over.gated ? { gated: true, approvalInstanceId: 'ai-1' } : null),
    };
    const auditOutbox = {
      record: jest.fn().mockImplementation((_tx, cmd) => {
        audit.push(cmd);
      }),
    };
    const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn({}) };
    const tenancy = { getClient: () => prisma };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      tenancy as never,
      commandGovernance as never,
      repo as never,
      {} as never,
      projectAccess as never,
      auditOutbox as never,
    );
    return { service, repo, commandGovernance, auditOutbox, audit };
  }

  it('start: a ready project → ACTIVE, records actualStartDate, writes a TRANSITION audit', async () => {
    const { service, repo, audit } = build();
    const result = await service.start(identity([]), 'project-1', { actualStartDate: '2026-09-01' });

    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      'project-1',
      expect.objectContaining({ status: 'ACTIVE', actualStartDate: new Date('2026-09-01') }),
    );
    expect((result as { status: string }).status).toBe('ACTIVE');
    expect(audit.some((c) => (c as { eventType: string }).eventType === 'PROJECT_START')).toBe(true);
  });

  it('start: an unmet MANDATORY condition is a 400 and nothing is written', async () => {
    const { service, repo } = build({
      snapshot: { ...readyStartSnapshot, boq: { versions: [{ status: 'DRAFT' }] } },
    });
    await expect(
      service.start(identity([]), 'project-1', { actualStartDate: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('start: an unsatisfied WAIVABLE condition without an override is a 400', async () => {
    const { service, repo } = build({
      snapshot: { ...readyStartSnapshot, members: [{ id: 'm-1' }] },
    });
    await expect(
      service.start(identity([]), 'project-1', { actualStartDate: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('start: a valid per-condition waiver proceeds and records a PROJECT_CONDITION_WAIVED event', async () => {
    const { service, repo, audit } = build({
      snapshot: { ...readyStartSnapshot, members: [{ id: 'm-1' }] },
    });
    await service.start(identity([]), 'project-1', {
      actualStartDate: '2026-09-01',
      overrides: [{ condition: 'DELIVERY_TEAM', reason: 'Solo PM for a small job' }],
    });
    expect(repo.update).toHaveBeenCalled();
    const waiver = audit.find((c) => (c as { eventType: string }).eventType === 'PROJECT_CONDITION_WAIVED');
    expect(waiver).toMatchObject({ action: 'WAIVE', reason: 'Solo PM for a small job' });
  });

  it('start: the governance gate still fires after readiness passes (409)', async () => {
    const { service, repo } = build({ gated: true });
    await expect(
      service.start(identity([]), 'project-1', { actualStartDate: '2026-09-01' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('start: rejects when the project is not DRAFT', async () => {
    const { service } = build({ project: { id: 'project-1', status: 'ACTIVE' } });
    await expect(
      service.start(identity([]), 'project-1', { actualStartDate: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('close: from CLOSEOUT records closureDate + closureSummary → CLOSED', async () => {
    const { service, repo } = build({
      project: { id: 'project-1', status: 'CLOSEOUT' },
      snapshot: { ...readyStartSnapshot, status: 'CLOSEOUT' },
    });
    await service.close(identity([]), 'project-1', {
      closureDate: '2027-09-30',
      closureSummary: 'Final account agreed; retention released.',
    });
    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      'project-1',
      expect.objectContaining({
        status: 'CLOSED',
        closureDate: new Date('2027-09-30'),
        closureSummary: 'Final account agreed; retention released.',
      }),
    );
  });
});

// ADR-026 CONST-VAR-011 (Route 7A) — project-before-contract: apex authority (CFO/CEO) may waive the
// two MANDATORY Start conditions, recorded as PROJECT_CONDITION_WAIVED; a non-apex caller may not.
describe('ProjectService.start — Route 7A apex waiver of MANDATORY Start conditions (CONST-VAR-011)', () => {
  const identityWithRoles = (roles: string[]): RequestIdentity => ({
    userId: 'user-1',
    tenantSlug: 'acco',
    activeOrganizationId: 'org-1',
    roles,
    permissions: [PERMISSIONS.projectsManage],
  });

  // A DRAFT project with NO active main contract → ACTIVE_MAIN_CONTRACT + CONTRACT_START_DATE unmet.
  const noContractSnapshot = {
    status: 'DRAFT',
    commercialModel: 'CLIENT_CONTRACT',
    startDate: new Date('2026-02-01'),
    expectedEndDate: new Date('2027-08-31'),
    clientId: 'client-1',
    client: { status: 'ACTIVE' },
    contracts: [],
    boq: { versions: [{ status: 'BASELINED' }] },
    members: [{ id: 'm-1' }, { id: 'm-2' }],
  };

  function build() {
    const audit: unknown[] = [];
    const repo = {
      findById: jest.fn().mockResolvedValue({ id: 'project-1', status: 'DRAFT' }),
      findActiveSuspension: jest.fn().mockResolvedValue(null),
      findReadinessSnapshot: jest.fn().mockResolvedValue(noContractSnapshot),
      update: jest.fn().mockImplementation((_tx, _id, data) => ({ id: 'project-1', ...data })),
    };
    const commandGovernance = { gateStateTransition: jest.fn().mockResolvedValue(null) };
    const auditOutbox = { record: jest.fn().mockImplementation((_tx, cmd) => audit.push(cmd)) };
    const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn({}) };
    const tenancy = { getClient: () => prisma };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      tenancy as never,
      commandGovernance as never,
      repo as never,
      {} as never,
      projectAccess as never,
      auditOutbox as never,
    );
    return { service, repo, audit };
  }

  const waivers = [
    { condition: 'ACTIVE_MAIN_CONTRACT', reason: 'CEO-approved at-risk start; contract in signature' },
    { condition: 'CONTRACT_START_DATE', reason: 'Commencement letter to follow' },
  ];

  it('apex (CEO) may waive both MANDATORY Start conditions → ACTIVE, audited with apexAuthorised=true', async () => {
    const { service, repo, audit } = build();
    const result = await service.start(identityWithRoles(['CEO']), 'project-1', {
      actualStartDate: '2026-09-01',
      overrides: waivers,
    });
    expect((result as { status: string }).status).toBe('ACTIVE');

    const waiverEvents = audit.filter(
      (c) => (c as { eventType: string }).eventType === 'PROJECT_CONDITION_WAIVED',
    );
    expect(waiverEvents).toHaveLength(2);
    for (const e of waiverEvents) {
      expect((e as { after: { apexAuthorised: boolean } }).after.apexAuthorised).toBe(true);
    }
    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      'project-1',
      expect.objectContaining({ status: 'ACTIVE' }),
    );
  });

  it('CFO also carries Start-chain apex authority for the waiver', async () => {
    const { service, repo } = build();
    await service.start(identityWithRoles(['CFO']), 'project-1', {
      actualStartDate: '2026-09-01',
      overrides: waivers,
    });
    expect(repo.update).toHaveBeenCalled();
  });

  it('a NON-apex caller (no CFO/CEO role) is a 400 — MANDATORY conditions stay hard blockers', async () => {
    const { service, repo } = build();
    await expect(
      service.start(identityWithRoles(['PROJECT_MANAGER']), 'project-1', {
        actualStartDate: '2026-09-01',
        overrides: waivers,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

// Project type (PTD1-PTD5) — category is required on create and persisted; a supplied subtype must
// be an ACTIVE ProjectSubtype in the caller's org whose category matches the project's category.
describe('ProjectService.create — project type (category + subtype)', () => {
  const ACTIVE_COMMERCIAL = {
    id: 'sub-1',
    organizationId: 'org-1',
    category: ProjectCategory.COMMERCIAL,
    name: 'Office buildings',
    status: 'ACTIVE',
  };

  function build(subtypeRow: unknown = ACTIVE_COMMERCIAL) {
    const audit: unknown[] = [];
    const repo = {
      findByCode: jest.fn().mockResolvedValue(null),
      allocateCode: jest.fn().mockResolvedValue('ACCO-WBR-26-0001'),
      create: jest.fn().mockImplementation((_tx, data) => ({ id: 'project-1', ...data })),
      createMember: jest.fn().mockResolvedValue({ id: 'member-1' }),
      addMemberRoles: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const tx = {
      client: { findFirst: jest.fn().mockResolvedValue({ id: 'client-1', name: 'Acme', status: 'ACTIVE' }) },
      district: { findFirst: jest.fn().mockResolvedValue({ id: 'dist-1', code: 'WBR', active: true }) },
      projectSubtype: { findFirst: jest.fn().mockResolvedValue(subtypeRow) },
      organization: { findUnique: jest.fn().mockResolvedValue({ shortCode: 'ACCO' }) },
    };
    const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
    const tenancy = { getClient: () => prisma };
    const auditOutbox = { record: jest.fn().mockImplementation((_tx, cmd) => audit.push(cmd)) };
    const service = new ProjectService(
      tenancy as never,
      {} as never,
      repo as never,
      {} as never,
      { assertMember: jest.fn() } as never,
      auditOutbox as never,
    );
    return { service, repo, tx };
  }

  const baseDto = {
    name: 'Al-Baraka Tower',
    districtId: 'dist-1',
    clientId: 'client-1',
    category: ProjectCategory.COMMERCIAL,
  };

  it('persists the category, and the matching ACTIVE subtype', async () => {
    const { service, repo } = build();
    await service.create(identity([]), { ...baseDto, subtypeId: 'sub-1' } as never);
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: ProjectCategory.COMMERCIAL, subtypeId: 'sub-1' }),
    );
  });

  it('creates with a category and no subtype', async () => {
    const { service, repo, tx } = build();
    await service.create(identity([]), { ...baseDto, subtypeId: undefined } as never);
    expect(tx.projectSubtype.findFirst).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: ProjectCategory.COMMERCIAL, subtypeId: undefined }),
    );
  });

  it('rejects a subtype whose category does not match the project category (400)', async () => {
    const { service, repo } = build({ ...ACTIVE_COMMERCIAL, category: ProjectCategory.INDUSTRIAL });
    await expect(
      service.create(identity([]), { ...baseDto, subtypeId: 'sub-1' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive subtype (400)', async () => {
    const { service, repo } = build({ ...ACTIVE_COMMERCIAL, status: 'INACTIVE' });
    await expect(
      service.create(identity([]), { ...baseDto, subtypeId: 'sub-1' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a subtype from another org / not found (404)', async () => {
    const { service, repo } = build(null);
    await expect(
      service.create(identity([]), { ...baseDto, subtypeId: 'sub-x' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('ProjectService.update — project type (category + subtype)', () => {
  const draftProject = {
    id: 'project-1',
    organizationId: 'org-1',
    status: 'DRAFT',
    commercialModel: 'CLIENT_CONTRACT',
    category: ProjectCategory.COMMERCIAL,
    subtypeId: null,
  };

  function build(over: { project?: unknown; subtypeRow?: unknown } = {}) {
    const repo = {
      findById: jest.fn().mockResolvedValue(over.project ?? draftProject),
      update: jest.fn().mockImplementation((_p, id, data) => ({ id, ...data })),
    };
    const prisma = {
      client: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSubtype: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            'subtypeRow' in over
              ? over.subtypeRow
              : { id: 'sub-1', category: ProjectCategory.COMMERCIAL, status: 'ACTIVE', name: 'Hotels' },
          ),
      },
    };
    const tenancy = { getClient: () => prisma };
    const service = new ProjectService(
      tenancy as never,
      {} as never,
      repo as never,
      {} as never,
      { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );
    return { service, repo, prisma };
  }

  it('persists a category change and a matching subtype', async () => {
    const { service, repo } = build();
    await service.update(identity([]), 'project-1', {
      category: ProjectCategory.COMMERCIAL,
      subtypeId: 'sub-1',
    } as never);
    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      'project-1',
      expect.objectContaining({ category: ProjectCategory.COMMERCIAL, subtypeId: 'sub-1' }),
    );
  });

  it('rejects a new subtype whose category mismatches the effective category (400)', async () => {
    const { service, repo } = build({
      subtypeRow: { id: 'sub-2', category: ProjectCategory.INDUSTRIAL, status: 'ACTIVE', name: 'Warehouses' },
    });
    await expect(
      service.update(identity([]), 'project-1', { subtypeId: 'sub-2' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects when a category change strands the existing subtype in the wrong category (400)', async () => {
    // Project already has a COMMERCIAL subtype; caller switches the category to INDUSTRIAL without
    // clearing the subtype — the effective (existing) subtype no longer matches.
    const { service, repo } = build({
      project: { ...draftProject, subtypeId: 'sub-1' },
      subtypeRow: { id: 'sub-1', category: ProjectCategory.COMMERCIAL, status: 'ACTIVE', name: 'Hotels' },
    });
    await expect(
      service.update(identity([]), 'project-1', { category: ProjectCategory.INDUSTRIAL } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('ProjectService.setMemberRoles', () => {
  function buildRoleEdit(member: unknown) {
    const repo = {
      findById: jest.fn().mockResolvedValue({ id: 'project-1' }),
      findActiveMember: jest.fn().mockResolvedValue(member),
      deactivateMemberRoles: jest.fn().mockResolvedValue({ count: 1 }),
      addMemberRoles: jest.fn().mockResolvedValue({ count: 1 }),
    };
    // $transaction runs the callback with a throwaway tx client — repo calls are mocked, so the
    // client it receives is irrelevant.
    const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn({}) };
    const tenancy = { getClient: () => prisma };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      tenancy as never,
      {} as never,
      repo as never,
      {} as never,
      projectAccess as never,
      {} as never,
    );
    return { service, repo };
  }

  it('closes the current roles and opens the new set (versioned edit)', async () => {
    const { service, repo } = buildRoleEdit({ id: 'member-1' });

    await service.setMemberRoles(identity([]), 'project-1', 'user-2', {
      roles: [ProjectRole.SITE_ENGINEER, ProjectRole.VIEWER],
    });

    expect(repo.deactivateMemberRoles).toHaveBeenCalledWith(expect.anything(), 'member-1');
    expect(repo.addMemberRoles).toHaveBeenCalledWith(
      expect.anything(),
      'member-1',
      [ProjectRole.SITE_ENGINEER, ProjectRole.VIEWER],
      'user-1',
    );
  });

  it('rejects when the user is not an active member', async () => {
    const { service, repo } = buildRoleEdit(null);

    await expect(
      service.setMemberRoles(identity([]), 'project-1', 'user-2', { roles: [ProjectRole.VIEWER] }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(repo.deactivateMemberRoles).not.toHaveBeenCalled();
    expect(repo.addMemberRoles).not.toHaveBeenCalled();
  });
});
