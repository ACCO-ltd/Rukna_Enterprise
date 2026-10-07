import {
  ForbiddenException,
  HttpStatus,
  RequestMethod,
  type ExecutionContext,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '@erp/types';

import { PermissionsGuard } from '../../../../common/guards/permissions.guard.js';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/decorators/require-permissions.decorator.js';
import { MaterialRequestController } from './material-request.controller.js';

/**
 * The approve route — POST /procurement/material-requests/:id/approve — is gated by
 * approve:material-request alone and hands the call straight to MaterialRequestService.approve.
 */
describe('MaterialRequestController — approve route', () => {
  const handler = MaterialRequestController.prototype.approve;

  function allowed(permissions: string[]): boolean {
    const context = {
      getHandler: () => handler,
      getClass: () => MaterialRequestController,
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u', permissions } }) }),
    } as unknown as ExecutionContext;
    try {
      return new PermissionsGuard(new Reflector()).canActivate(context);
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  it('is POST :id/approve answering 200', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/approve');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
  });

  it('requires approve:material-request', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual([
      PERMISSIONS.materialRequestsApprove,
    ]);
  });

  it('lets a holder of approve:material-request through', () => {
    expect(allowed([PERMISSIONS.materialRequestsApprove])).toBe(true);
  });

  it('refuses a requester who can only create, submit and view', () => {
    expect(
      allowed([
        PERMISSIONS.procurementView,
        PERMISSIONS.materialRequestsCreate,
        PERMISSIONS.materialRequestsSubmit,
      ]),
    ).toBe(false);
  });

  it('delegates to MaterialRequestService.approve with the caller and id', async () => {
    const service = { approve: jest.fn().mockResolvedValue({ id: 'mr1', status: 'APPROVED' }) };
    const controller = new MaterialRequestController(service as never);
    const identity = { userId: 'bob', activeOrganizationId: 'o1' } as never;

    await expect(controller.approve(identity, 'mr1')).resolves.toEqual({
      id: 'mr1',
      status: 'APPROVED',
    });
    expect(service.approve).toHaveBeenCalledWith(identity, 'mr1');
  });
});
