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

import { UnitsOfMeasureController } from './units-of-measure.controller.js';
import { UomController } from './uom.controller.js';
import { UomService } from '../application/uom.service.js';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard.js';

/**
 * `GET /units-of-measure` is readable by any signed-in member (the BOQ unit picker), while the
 * registry's management routes on `/procurement/uom` keep `manage:procurement-config`. Stands in
 * for the JWT with an `x-perms` header and runs the real global PermissionsGuard. No database.
 */
@Injectable()
class HeaderAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const header = req.headers['x-perms'];
    req.user = {
      userId: 'u1',
      activeOrganizationId: req.headers['x-org'] ?? 'org-1',
      roles: [],
      permissions: header ? header.split(',') : [],
    };
    return true;
  }
}

describe('UnitsOfMeasureController — GET /units-of-measure', () => {
  let app: INestApplication;
  const listLookup = jest.fn();
  const findAll = jest.fn();
  const create = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UnitsOfMeasureController, UomController],
      providers: [
        { provide: UomService, useValue: { listLookup, findAll, create } },
        { provide: APP_GUARD, useClass: HeaderAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    listLookup.mockReset().mockResolvedValue([{ code: 'M3', name: 'Cubic metre', symbol: 'm³' }]);
    findAll.mockReset().mockResolvedValue([]);
    create.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is readable with no permissions at all, and returns the projection', async () => {
    const res = await request(app.getHttpServer()).get('/units-of-measure').expect(200);
    expect(res.body).toEqual([{ code: 'M3', name: 'Cubic metre', symbol: 'm³' }]);
  });

  it('defaults to ACTIVE and reads the caller’s own organization', async () => {
    await request(app.getHttpServer()).get('/units-of-measure').set('x-org', 'org-acco').expect(200);
    expect(listLookup).toHaveBeenCalledWith(
      expect.objectContaining({ activeOrganizationId: 'org-acco' }),
      'ACTIVE',
    );
  });

  it('passes status=INACTIVE through', async () => {
    await request(app.getHttpServer()).get('/units-of-measure?status=INACTIVE').expect(200);
    expect(listLookup).toHaveBeenCalledWith(expect.anything(), 'INACTIVE');
  });

  it('rejects an unknown status with 400', async () => {
    await request(app.getHttpServer()).get('/units-of-measure?status=DELETED').expect(400);
    expect(listLookup).not.toHaveBeenCalled();
  });

  it('exposes no write route', async () => {
    await request(app.getHttpServer())
      .post('/units-of-measure')
      .send({ code: 'X', name: 'X', symbol: 'x' })
      .expect(404);
  });

  it('leaves the management surface gated on manage:procurement-config', async () => {
    await request(app.getHttpServer()).get('/procurement/uom').expect(403);
    await request(app.getHttpServer())
      .post('/procurement/uom')
      .send({ code: 'X', name: 'X', symbol: 'x' })
      .expect(403);
    expect(create).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/procurement/uom')
      .set('x-perms', PERMISSIONS.procurementConfigManage)
      .expect(200);
  });
});
