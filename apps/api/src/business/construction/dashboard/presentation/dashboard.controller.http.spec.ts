import { type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard.js';
import { DashboardService } from '../application/dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';

/** `GET /dashboard` — authenticated only: every user has a dashboard; gating is inside the read model. */
describe('GET /dashboard', () => {
  let app: INestApplication;
  const get = jest.fn(async () => ({ stage: 'RUNNING', todo: [] }));
  let authenticated = true;
  let permissions: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: { get } },
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
      .useValue({ canActivate: () => authenticated })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => {
    get.mockClear();
    authenticated = true;
  });

  it('serves a caller with no permissions at all (no @RequirePermissions)', async () => {
    permissions = [];
    const res = await request(app.getHttpServer()).get('/dashboard').expect(200);
    expect(res.body).toEqual({ stage: 'RUNNING', todo: [] });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', activeOrganizationId: 'o1' }),
    );
  });

  it('refuses an unauthenticated request', async () => {
    authenticated = false;
    await request(app.getHttpServer()).get('/dashboard').expect(403);
    expect(get).not.toHaveBeenCalled();
  });
});
