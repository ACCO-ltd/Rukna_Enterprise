import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { WorkflowsService } from './workflows.service.js';
import { GovernanceAuthoringConfig } from './governance-authoring.config.js';

/**
 * ADR-027 item 8b — the authoring feature flag gates the WRITE surface.
 *
 * With `GOVERNANCE_AUTHORING_ENABLED` off, a mutation (create-draft) must 403 and touch no
 * repository. With it on, the same call reaches the repository. Reads are unaffected either way.
 * The flag is driven through the real `GovernanceAuthoringConfig` + a fake `ConfigService`, so this
 * proves the wiring end-to-end without a database.
 */
function build(flag: string | undefined) {
  const repo = {
    createPolicyDraft: jest.fn().mockResolvedValue({ id: 'p1', status: 'DRAFT' }),
    findBindingsForOrg: jest.fn().mockResolvedValue([]),
  };
  const config = { get: (key: string) => (key === GovernanceAuthoringConfig.ENV_KEY ? flag : undefined) } as unknown as ConfigService;
  const authoring = new GovernanceAuthoringConfig(config);
  const svc = new WorkflowsService(repo as never, authoring);
  return { svc, repo };
}

describe('WorkflowsService authoring feature flag', () => {
  it('blocks a mutation with 403 and never calls the repository when the flag is OFF', async () => {
    const { svc, repo } = build(undefined);
    await expect(svc.createPolicyDraft('o1', { policyKey: 'K' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.createPolicyDraft).not.toHaveBeenCalled();
  });

  it('allows the mutation to reach the repository when the flag is ON', async () => {
    const { svc, repo } = build('true');
    await expect(svc.createPolicyDraft('o1', { policyKey: 'K' })).resolves.toEqual({ id: 'p1', status: 'DRAFT' });
    expect(repo.createPolicyDraft).toHaveBeenCalledWith('o1', 'K', undefined);
  });

  it('leaves reads available regardless of the flag', async () => {
    const off = build(undefined);
    await expect(off.svc.listBindings('o1')).resolves.toEqual([]);
    expect(off.repo.findBindingsForOrg).toHaveBeenCalledWith('o1');
  });
});
