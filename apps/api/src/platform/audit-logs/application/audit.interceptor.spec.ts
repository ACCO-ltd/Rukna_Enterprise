import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

import { NoAudit } from '../../../common/decorators/no-audit.decorator';
import { AuditInterceptor } from './audit.interceptor';

class Routes {
  save() {}
  @NoAudit()
  preview() {}
}

function run(handler: () => void, method = 'POST') {
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
  const interceptor = new AuditInterceptor(auditLogs as never, new Reflector());
  const request = {
    method,
    user: { userId: 'u1', activeOrganizationId: 'org1' },
    path: '/invoice-document-settings/preview',
    baseUrl: '',
    route: { path: '/invoice-document-settings/preview' },
    params: {},
    body: {},
    ip: '127.0.0.1',
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => Routes,
  };
  return {
    auditLogs,
    result: lastValueFrom(interceptor.intercept(context as never, { handle: () => of('ok') })),
  };
}

describe('AuditInterceptor', () => {
  it('logs a mutation', async () => {
    const { auditLogs, result } = run(Routes.prototype.save);
    await expect(result).resolves.toBe('ok');
    expect(auditLogs.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'POST', userId: 'u1' }));
  });

  it('skips a route marked @NoAudit()', async () => {
    const { auditLogs, result } = run(Routes.prototype.preview);
    await expect(result).resolves.toBe('ok');
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('skips reads', async () => {
    const { auditLogs, result } = run(Routes.prototype.save, 'GET');
    await expect(result).resolves.toBe('ok');
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
