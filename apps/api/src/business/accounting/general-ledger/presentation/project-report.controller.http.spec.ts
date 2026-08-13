import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ProjectReportController } from './project-report.controller.js';
import { PLReportService } from '../application/pl-report.service.js';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';

/**
 * Tier 1 thin (ADR-013): GET /projects/:id/pl routes to the existing P&L query with
 * the project id taken from the path. No DB — PLReportService is mocked; the point is
 * that the route resolves and the path id wins.
 */
describe('ProjectReportController — GET /projects/:id/pl', () => {
  let app: INestApplication;
  const generate = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectReportController],
      providers: [{ provide: PLReportService, useValue: { generate } }],
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
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('routes to the P&L service with projectId taken from the path', async () => {
    generate.mockResolvedValue({ netIncome: '100.00', projectId: 'proj-42' });

    const res = await request(app.getHttpServer())
      .get('/projects/proj-42/pl')
      .query({ fromDate: '2026-01-01', toDate: '2026-12-31' })
      .expect(200);

    expect(res.body.netIncome).toBe('100.00');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ activeOrganizationId: 'o1' }),
      expect.objectContaining({ fromDate: '2026-01-01', toDate: '2026-12-31', projectId: 'proj-42' }),
    );
  });

  it('the path project id overrides a projectId supplied in the query', async () => {
    generate.mockResolvedValue({ netIncome: '0.00' });

    await request(app.getHttpServer())
      .get('/projects/path-proj/pl')
      .query({ fromDate: '2026-01-01', toDate: '2026-12-31', projectId: 'query-proj' })
      .expect(200);

    expect(generate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'path-proj' }),
    );
  });
});
