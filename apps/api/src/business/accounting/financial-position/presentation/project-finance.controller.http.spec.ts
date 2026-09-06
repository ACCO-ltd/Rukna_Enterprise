import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ProjectFinancialPositionController } from './project-financial-position.controller.js';
import { ProjectFinancialPositionService } from '../application/project-financial-position.service.js';
import { ProjectCostReconciliationService } from '../application/project-cost-reconciliation.service.js';
import { ProjectFinanceOverviewService } from '../application/project-finance-overview.service.js';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';

/**
 * The Finance workspace's routes resolve, and refuse a project the caller cannot see.
 *
 * Route-level rather than unit: a controller can compile, its service can be correct, and the
 * endpoint still be unreachable or ungated. `ProjectAccessGuard` here is the thing that stops
 * `view:accounting` alone from reading any project's money.
 */
describe('Project Finance routes', () => {
  let app: INestApplication;
  const getForProject = jest.fn();
  const getReconciliation = jest.fn();
  const getOverview = jest.fn();
  const projectAccess = jest.fn(() => true);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectFinancialPositionController],
      providers: [
        { provide: ProjectFinancialPositionService, useValue: { getForProject } },
        {
          provide: ProjectCostReconciliationService,
          useValue: { getForProject: getReconciliation },
        },
        { provide: ProjectFinanceOverviewService, useValue: { getOverview } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = {
            userId: 'u1',
            activeOrganizationId: 'o1',
            roles: [],
            permissions: ['*'],
          };
          return true;
        },
      })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => projectAccess() })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => projectAccess.mockReturnValue(true));

  afterAll(async () => {
    await app.close();
  });

  it('FIN-01: the Finance Overview resolves for a project the caller can see', async () => {
    getOverview.mockResolvedValue({ projectId: 'p1', attention: [], activity: [] });

    const res = await request(app.getHttpServer())
      .get('/projects/p1/finance/overview')
      .expect(200);

    expect(res.body.projectId).toBe('p1');
    expect(getOverview).toHaveBeenCalledWith(
      expect.objectContaining({ activeOrganizationId: 'o1' }),
      'p1',
    );
  });

  it('FIN-02: the reconciliation read model resolves', async () => {
    getReconciliation.mockResolvedValue({ projectId: 'p1', reconciled: true, variance: '0.00' });

    const res = await request(app.getHttpServer())
      .get('/projects/p1/cost-reconciliation')
      .expect(200);

    expect(res.body.reconciled).toBe(true);
  });

  it('FIN-03: every project Finance route refuses a project the caller cannot access', async () => {
    projectAccess.mockReturnValue(false);

    await request(app.getHttpServer()).get('/projects/not-mine/finance/overview').expect(403);
    await request(app.getHttpServer()).get('/projects/not-mine/cost-reconciliation').expect(403);
    await request(app.getHttpServer()).get('/projects/not-mine/financial-position').expect(403);
  });
});
