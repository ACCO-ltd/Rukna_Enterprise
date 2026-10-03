import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PERMISSIONS } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard.js';
import { FinancePortfolioService } from '../application/finance-portfolio.service.js';
import { FinancePortfolioController } from './finance-portfolio.controller.js';

/** ADR-043 — `GET /finance/projects` resolves, is gated on view:financial-position, validates its query. */
describe('GET /finance/projects', () => {
  let app: INestApplication;
  const list = jest.fn(async () => ({ items: [] }));
  let permissions: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FinancePortfolioController],
      providers: [
        { provide: FinancePortfolioService, useValue: { list } },
        // As in AppModule: authentication (a stand-in here) runs before the permission guard.
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: ExecutionContext) => {
              ctx.switchToHttp().getRequest().user = {
                userId: 'u1',
                activeOrganizationId: 'o1',
                roles: [],
                permissions,
              };
              return true;
            },
          },
        },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => list.mockClear());

  it('refuses a caller without view:financial-position (e.g. Construction Director, view:accounting only)', async () => {
    permissions = [PERMISSIONS.accountingView, PERMISSIONS.boqViewCost];
    await request(app.getHttpServer()).get('/finance/projects').expect(403);
    expect(list).not.toHaveBeenCalled();
  });

  it('serves a finance caller and passes the filters through', async () => {
    permissions = [PERMISSIONS.financialPositionView];
    await request(app.getHttpServer()).get('/finance/projects?queue=TO_BILL&search=clinic&status=ACTIVE').expect(200);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ activeOrganizationId: 'o1' }),
      expect.objectContaining({ queue: 'TO_BILL', search: 'clinic', status: 'ACTIVE' }),
    );
  });

  it('rejects an unknown queue', async () => {
    permissions = [PERMISSIONS.financialPositionView];
    await request(app.getHttpServer()).get('/finance/projects?queue=CERTIFIED').expect(400);
  });
});
