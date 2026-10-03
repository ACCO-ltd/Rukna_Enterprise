import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_DEFINITIONS, PERMISSIONS } from '@erp/types';

import { PermissionsGuard } from '../../../../common/guards/permissions.guard.js';
import {
  REQUIRED_ANY_PERMISSION_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { CommercialController } from './commercial.controller.js';

/**
 * ADR-043 decision 1 — "Mark ready to bill" / "Undo ready" are open to the finance set
 * (`view:contract` + `manage:receivable`) OR the narrow `mark-ready:billing`, which the seed gives
 * the Construction Director and no one else. The role sets are read from the seed itself.
 */

const SEED = join(__dirname, '../../../../../prisma/seeds/acco-team-roles.seed.ts');

function seededPermissions(roleName: string): string[] {
  const seed = readFileSync(SEED, 'utf8');
  const start = seed.indexOf(`name: '${roleName}'`);
  expect(start).toBeGreaterThan(-1);
  const end = seed.indexOf('\n  },', start);
  return [...seed.slice(start, end).matchAll(/P\.(\w+)/g)].map(
    (m) => PERMISSIONS[m[1] as keyof typeof PERMISSIONS],
  );
}

const HANDLERS = ['markReadyToBill', 'revokeReadyToBill'] as const;

function allowed(handler: (typeof HANDLERS)[number], permissions: string[]): boolean {
  const context = {
    getHandler: () => CommercialController.prototype[handler],
    getClass: () => CommercialController,
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u', permissions } }) }),
  } as unknown as ExecutionContext;
  try {
    return new PermissionsGuard(new Reflector()).canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('mark ready / undo ready — permission gate', () => {
  it.each(HANDLERS)('%s requires view:contract AND (manage:receivable OR mark-ready:billing)', (handler) => {
    const fn = CommercialController.prototype[handler];
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, fn)).toEqual([PERMISSIONS.contractsView]);
    expect(Reflect.getMetadata(REQUIRED_ANY_PERMISSION_KEY, fn)).toEqual([
      PERMISSIONS.receivablesManage,
      PERMISSIONS.billingMarkReady,
    ]);
  });

  describe.each(HANDLERS)('%s — seeded roles', (handler) => {
    it.each(['Construction Director', 'Finance Officer'])('%s is allowed', (role) => {
      expect(allowed(handler, seededPermissions(role))).toBe(true);
    });

    it.each(['Project Manager', 'Site Engineer', 'Procurement Manager'])('%s is refused', (role) => {
      expect(allowed(handler, seededPermissions(role))).toBe(false);
    });

    it('mark-ready:billing alone, without view:contract, is refused', () => {
      expect(allowed(handler, [PERMISSIONS.billingMarkReady])).toBe(false);
    });

    it('the finance set still works without the new permission', () => {
      expect(allowed(handler, [PERMISSIONS.contractsView, PERMISSIONS.receivablesManage])).toBe(true);
    });
  });

  it('only the Construction Director is seeded mark-ready:billing (not the Project Manager or Site Engineer)', () => {
    for (const role of ['Construction Director', 'Project Manager', 'Site Engineer', 'Procurement Manager', 'Finance Officer']) {
      expect(seededPermissions(role).includes(PERMISSIONS.billingMarkReady)).toBe(role === 'Construction Director');
    }
  });

  it('the Construction Director gains no finance permission with it', () => {
    const cd = seededPermissions('Construction Director');
    for (const finance of [
      PERMISSIONS.receivablesManage,
      PERMISSIONS.receiptsCreate,
      PERMISSIONS.ipcIssue,
      PERMISSIONS.journalsManage,
      PERMISSIONS.financialPositionView,
    ]) {
      expect(cd).not.toContain(finance);
    }
  });

  it('is catalogued as a Commercial, MEDIUM-risk permission', () => {
    expect(PERMISSION_DEFINITIONS.find((d) => d.key === PERMISSIONS.billingMarkReady)).toMatchObject({
      action: 'mark-ready',
      resource: 'billing',
      domain: 'Commercial',
      riskClass: 'MEDIUM',
    });
  });

  it('grants nothing else: no other route names mark-ready:billing', () => {
    const src = join(__dirname, '../../../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(entry) && !/\.spec\.ts$/.test(entry) && /PERMISSIONS\.billingMarkReady|'mark-ready:billing'/.test(readFileSync(path, 'utf8'))) {
          hits.push(path.slice(src.length + 1).replace(/\\/g, '/'));
        }
      }
    };
    walk(src);
    expect(hits).toEqual(['business/construction/commercial/presentation/commercial.controller.ts']);
  });
});
