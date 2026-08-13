import {
  CanActivate,
  Controller,
  ExecutionContext,
  HttpCode,
  Injectable,
  type INestApplication,
  Post,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PERMISSIONS } from '@erp/types';

import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from '../decorators/require-permissions.decorator.js';

/**
 * End-to-end proof for #25 (A2) / #28 (P5): the global PermissionsGuard actually
 * returns HTTP 403 when the caller lacks the declared permission. Stands in for a
 * live login by injecting req.user from an `x-perms` header (mirroring what
 * JwtAuthGuard + the JWT payload provide in production). No database required.
 */
@Injectable()
class HeaderAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const header = req.headers['x-perms'];
    req.user = {
      userId: 'u1',
      activeOrganizationId: 'o1',
      roles: [],
      permissions: header ? header.split(',') : [],
    };
    return true;
  }
}

@Controller('probe')
class ProbeController {
  // Same shape as purchase-order.controller.ts:70-71 (@Post(':id/approve'))
  @Post('approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.purchaseOrdersApprove)
  approve() {
    return { ok: true };
  }
}

describe('PermissionsGuard — HTTP end-to-end as a global APP_GUARD', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: APP_GUARD, useClass: HeaderAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 403 when the required permission is absent', async () => {
    await request(app.getHttpServer()).post('/probe/approve').expect(403);
  });

  it('returns 403 when only a different permission is present', async () => {
    await request(app.getHttpServer())
      .post('/probe/approve')
      .set('x-perms', PERMISSIONS.projectsView)
      .expect(403);
  });

  it('returns 200 when the required permission is present', async () => {
    await request(app.getHttpServer())
      .post('/probe/approve')
      .set('x-perms', PERMISSIONS.purchaseOrdersApprove)
      .expect(200);
  });
});
