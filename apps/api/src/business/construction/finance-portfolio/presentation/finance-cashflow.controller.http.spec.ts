import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PERMISSIONS } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard.js';
import { FinanceCashflowService } from '../application/finance-cashflow.service.js';
import { FinanceCashflowController } from './finance-cashflow.controller.js';

/** ADR-043 Phase 4 — `GET /finance/cashflow` is gated on view:financial-position and validates its query. */
describe('GET /finance/cashflow', () => {
  let app: INestApplication;
  const forecast = jest.fn(async () => ({ currencies: [] }));
  let permissions: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FinanceCashflowController],
      providers: [
        { provide: FinanceCashflowService, useValue: { forecast } },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: ExecutionContext) => {
              ctx.switchToHttp().getRequest().user = { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions };
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
  beforeEach(() => forecast.mockClear());

  it('refuses a caller without view:financial-position', async () => {
    permissions = [PERMISSIONS.accountingView, PERMISSIONS.boqViewCost];
    await request(app.getHttpServer()).get('/finance/cashflow').expect(403);
    expect(forecast).not.toHaveBeenCalled();
  });

  it('serves a finance caller and passes the query through', async () => {
    permissions = [PERMISSIONS.financialPositionView];
    await request(app.getHttpServer())
      .get('/finance/cashflow?projectId=p1&from=2026-10-01&to=2026-12-31&bucket=MONTH')
      .expect(200);
    expect(forecast).toHaveBeenCalledWith(
      expect.objectContaining({ activeOrganizationId: 'o1' }),
      expect.objectContaining({ projectId: 'p1', from: '2026-10-01', to: '2026-12-31', bucket: 'MONTH' }),
    );
  });

  it('rejects an unknown bucket and a malformed date', async () => {
    permissions = [PERMISSIONS.financialPositionView];
    await request(app.getHttpServer()).get('/finance/cashflow?bucket=DAY').expect(400);
    await request(app.getHttpServer()).get('/finance/cashflow?from=next-week').expect(400);
  });
});
