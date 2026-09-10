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
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../decorators/require-permissions.decorator.js';

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

  // ADR-029 §8 A-1 — same shape as boq.controller.ts edit endpoints: any one of the OR set admits.
  @Post('edit')
  @HttpCode(200)
  @RequireAnyPermission(PERMISSIONS.boqEditScope, PERMISSIONS.boqEditCost, PERMISSIONS.boqManage)
  edit() {
    return { ok: true };
  }

  // ADR-029 §8 A-4 — same shape as boq.controller.ts contingency draw: manage-contingency required.
  @Post('draw-contingency')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.boqManageContingency)
  drawContingency() {
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

  // ─── ADR-029 §8 A-1 — RequireAnyPermission (OR) ─────────────────────────────────

  it('A-1: 403 when the caller holds none of the any-of edit caps', async () => {
    await request(app.getHttpServer())
      .post('/probe/edit')
      .set('x-perms', PERMISSIONS.boqView)
      .expect(403);
  });

  it('A-1: 200 with edit-scope:boq alone', async () => {
    await request(app.getHttpServer())
      .post('/probe/edit')
      .set('x-perms', PERMISSIONS.boqEditScope)
      .expect(200);
  });

  it('A-1: 200 with edit-cost:boq alone', async () => {
    await request(app.getHttpServer())
      .post('/probe/edit')
      .set('x-perms', PERMISSIONS.boqEditCost)
      .expect(200);
  });

  it('A-1: 200 under the backward-compatible manage:boq umbrella', async () => {
    await request(app.getHttpServer())
      .post('/probe/edit')
      .set('x-perms', PERMISSIONS.boqManage)
      .expect(200);
  });

  // ─── ADR-029 §8 A-4 — contingency draw authority ─────────────────────────────────

  it('A-4: 403 for a contingency draw without manage-contingency:boq (even with edit/view caps)', async () => {
    await request(app.getHttpServer())
      .post('/probe/draw-contingency')
      .set('x-perms', [PERMISSIONS.boqView, PERMISSIONS.boqEditScope, PERMISSIONS.boqManage].join(','))
      .expect(403);
  });

  it('A-4: 200 for a contingency draw with manage-contingency:boq', async () => {
    await request(app.getHttpServer())
      .post('/probe/draw-contingency')
      .set('x-perms', PERMISSIONS.boqManageContingency)
      .expect(200);
  });
});
