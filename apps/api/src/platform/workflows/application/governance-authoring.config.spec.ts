import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { GovernanceAuthoringConfig } from './governance-authoring.config.js';

/**
 * ADR-027 authoring feature flag (`GOVERNANCE_AUTHORING_ENABLED`, default OFF).
 *
 * Proves the flag defaults to disabled, enables only on an explicit truthy value, and that the
 * guard throws a 403 with the contract's message when off and passes through when on.
 */
function build(raw: string | undefined) {
  const config = { get: (key: string) => (key === GovernanceAuthoringConfig.ENV_KEY ? raw : undefined) } as unknown as ConfigService;
  return new GovernanceAuthoringConfig(config);
}

describe('GovernanceAuthoringConfig', () => {
  it('defaults to disabled when the env var is unset', () => {
    expect(build(undefined).isEnabled()).toBe(false);
  });

  it.each(['', 'false', 'FALSE', '0', 'no', 'off', 'yes '])(
    'stays disabled for the non-enabling value %p (fails safe)',
    (value) => {
      expect(build(value).isEnabled()).toBe(false);
    },
  );

  it.each(['true', 'TRUE', 'True', ' true ', '1'])(
    'enables only for the explicit truthy value %p',
    (value) => {
      expect(build(value).isEnabled()).toBe(true);
    },
  );

  it('assertEnabled throws a 403 with the contract message when off', () => {
    expect(() => build(undefined).assertEnabled()).toThrow(ForbiddenException);
    expect(() => build('false').assertEnabled()).toThrow('Governance authoring is not enabled');
  });

  it('assertEnabled passes through when on', () => {
    expect(() => build('true').assertEnabled()).not.toThrow();
  });
});
