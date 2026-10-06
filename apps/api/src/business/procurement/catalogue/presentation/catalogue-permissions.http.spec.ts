import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PERMISSIONS } from '@erp/types';

import { MaterialCategoryController } from './material-category.controller.js';
import { MaterialController } from './material.controller.js';
import { SpendCategoryController } from './spend-category.controller.js';
import { UomController } from './uom.controller.js';
import { MaterialCategoryService } from '../application/material-category.service.js';
import { MaterialService } from '../application/material.service.js';
import { SpendCategoryService } from '../application/spend-category.service.js';
import { UomService } from '../application/uom.service.js';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard.js';

/**
 * The catalogue feeds the buyer's order and request forms, so its reads open to
 * `view:procurement`; every write (create, deactivate/discontinue, reactivate) stays with
 * `manage:procurement-config`. Runs the real global PermissionsGuard with an `x-perms` header
 * standing in for the JWT. No database.
 */
@Injectable()
class HeaderAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const header = req.headers['x-perms'];
    req.user = {
      userId: 'u1',
      activeOrganizationId: 'org-1',
      roles: [],
      permissions: header ? header.split(',') : [],
    };
    return true;
  }
}

const service = () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue({ id: 'x1' }),
  create: jest.fn().mockResolvedValue({ id: 'x1' }),
  deactivate: jest.fn().mockResolvedValue({ id: 'x1' }),
  discontinue: jest.fn().mockResolvedValue({ id: 'x1' }),
  reactivate: jest.fn().mockResolvedValue({ id: 'x1' }),
});

const ROUTES = [
  { base: '/procurement/materials', deactivate: 'discontinue' },
  { base: '/procurement/material-categories', deactivate: 'deactivate' },
  { base: '/procurement/spend-categories', deactivate: 'deactivate' },
  { base: '/procurement/uom', deactivate: 'deactivate' },
] as const;

describe('Procurement catalogue — read vs write permissions', () => {
  let app: INestApplication;
  const services = {
    material: service(),
    materialCategory: service(),
    spendCategory: service(),
    uom: service(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MaterialController, MaterialCategoryController, SpendCategoryController, UomController],
      providers: [
        { provide: MaterialService, useValue: services.material },
        { provide: MaterialCategoryService, useValue: services.materialCategory },
        { provide: SpendCategoryService, useValue: services.spendCategory },
        { provide: UomService, useValue: services.uom },
        { provide: APP_GUARD, useClass: HeaderAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    // Validation off the write bodies is not under test; permissions are checked before pipes.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const BUYER = [PERMISSIONS.procurementView, PERMISSIONS.purchaseOrdersCreate].join(',');
  const MAINTAINER = PERMISSIONS.procurementConfigManage;

  describe.each(ROUTES)('$base', ({ base, deactivate }) => {
    it('lists and reads with view:procurement alone', async () => {
      await request(app.getHttpServer()).get(base).set('x-perms', BUYER).expect(200);
      await request(app.getHttpServer()).get(`${base}/x1`).set('x-perms', BUYER).expect(200);
    });

    it('still lists for the catalogue maintainer', async () => {
      await request(app.getHttpServer()).get(base).set('x-perms', MAINTAINER).expect(200);
    });

    it('refuses reads to a caller with neither permission', async () => {
      await request(app.getHttpServer()).get(base).set('x-perms', PERMISSIONS.projectsView).expect(403);
    });

    it('refuses every write to a buyer', async () => {
      await request(app.getHttpServer()).post(base).set('x-perms', BUYER).send({}).expect(403);
      await request(app.getHttpServer()).post(`${base}/x1/${deactivate}`).set('x-perms', BUYER).expect(403);
      await request(app.getHttpServer()).post(`${base}/x1/reactivate`).set('x-perms', BUYER).expect(403);
    });

    it('lets the maintainer deactivate and reactivate', async () => {
      await request(app.getHttpServer()).post(`${base}/x1/${deactivate}`).set('x-perms', MAINTAINER).expect(200);
      await request(app.getHttpServer()).post(`${base}/x1/reactivate`).set('x-perms', MAINTAINER).expect(200);
    });
  });
});
