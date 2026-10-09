import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@erp/types';

import { AwardPaymentController } from './award-payment.controller.js';

/**
 * The web finishes a gated supplier payment by calling `payment.pending[].continue.path`
 * (`POST /supplier-payments/:id/continue`). The service existed without a route, so the call
 * 404ed — this pins the route, its method and the class-level `manage:payable` gate.
 */
describe('AwardPaymentController', () => {
  const handler = AwardPaymentController.prototype.continuePayment;

  it('exposes POST supplier-payments/:id/continue', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('supplier-payments/:id/continue');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it('delegates to the service with the caller and the payment id', async () => {
    const continuePayment = jest.fn().mockResolvedValue({ payment: { id: 'p1' } });
    const controller = new AwardPaymentController({ continuePayment } as never, {} as never);
    const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;
    await expect(controller.continuePayment(identity, 'p1')).resolves.toEqual({ payment: { id: 'p1' } });
    expect(continuePayment).toHaveBeenCalledWith(identity, 'p1');
  });

  it('is gated on manage:payable like every money route', () => {
    const keys = Reflect.getMetadataKeys(AwardPaymentController);
    const values = keys.map((k) => Reflect.getMetadata(k, AwardPaymentController));
    expect(JSON.stringify(values)).toContain(PERMISSIONS.payablesManage);
  });
});
