import type { ConfigService } from '@nestjs/config';

import { HealthController } from './health.controller.js';
import { GovernanceAuthoringConfig } from '../workflows/application/governance-authoring.config.js';

/**
 * The liveness read surfaces the ADR-027 authoring feature flag under `capabilities` so the web can
 * hide the policy-authoring affordances when it is off. Off by default; true only when enabled.
 */
function controller(flag: string | undefined) {
  const config = { get: () => flag } as unknown as ConfigService;
  return new HealthController(new GovernanceAuthoringConfig(config));
}

describe('HealthController', () => {
  it('reports governanceAuthoringEnabled=false by default', () => {
    const result = controller(undefined).check();
    expect(result.status).toBe('ok');
    expect(result.capabilities.governanceAuthoringEnabled).toBe(false);
  });

  it('reports governanceAuthoringEnabled=true when the flag is on', () => {
    expect(controller('true').check().capabilities.governanceAuthoringEnabled).toBe(true);
  });
});
