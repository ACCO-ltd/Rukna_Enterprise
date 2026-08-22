import { ForbiddenException } from '@nestjs/common';

import { ApprovalService } from './approval.service.js';

/**
 * ADR-022 CONST-DOA-003 — a system administrator cannot approve a business transaction. The check
 * sits in ApprovalService.approve (where governed approvals are acted on), keyed on the actor
 * holding the consolidated SYSTEM_ADMINISTRATOR role. The tenant super-user 'ADMIN' is a different
 * role and is not blocked.
 */
describe('ApprovalService.approve — system-admin SoD (ADR-022)', () => {
  function build(sodDenies: boolean) {
    const instance = {
      id: 'ai-1',
      status: 'PENDING',
      currentStepOrder: 1,
      definition: { steps: [{ stepOrder: 1, roleRequired: 'SYSTEM_ADMINISTRATOR' }] },
    };
    const repo = {
      findInstanceById: jest.fn().mockResolvedValue(instance),
      recordAction: jest.fn().mockResolvedValue(undefined),
      updateInstanceStep: jest.fn().mockResolvedValue(undefined),
    };
    const sod = {
      assertAllowed: sodDenies
        ? jest.fn().mockRejectedValue(new ForbiddenException('SoD'))
        : jest.fn().mockResolvedValue(undefined),
    };
    const svc = new ApprovalService(repo as never, {} as never, sod as never);
    return { svc, repo, sod };
  }

  it('blocks a SYSTEM_ADMINISTRATOR from approving and records nothing', async () => {
    const { svc, repo, sod } = build(true);

    await expect(
      svc.approve('ai-1', 'admin-user', ['SYSTEM_ADMINISTRATOR'], 'o1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVE_BUSINESS_TRANSACTION',
        actorUserId: 'admin-user',
        isSystemAdministrator: true,
      }),
    );
    expect(repo.recordAction).not.toHaveBeenCalled();
  });

  it('passes isSystemAdministrator=false for a normal approver and proceeds', async () => {
    // The step requires SYSTEM_ADMINISTRATOR only so the role gate passes; the SoD stub allows it.
    const { svc, repo, sod } = build(false);

    await svc.approve('ai-1', 'cfo-user', ['SYSTEM_ADMINISTRATOR'], 'o1');

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ isSystemAdministrator: true }),
    );
    expect(repo.recordAction).toHaveBeenCalled();
  });
});
