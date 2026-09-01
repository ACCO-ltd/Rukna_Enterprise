import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { GovernanceAuthoringConfig } from '../workflows/application/governance-authoring.config.js';

/**
 * `GovernanceAuthoringConfig` depends only on the global `ConfigService`, so the health module can
 * provide it directly — the tenant-free liveness path stays free of the workflows module and its
 * tenant-scoped dependencies while still surfacing the ADR-027 authoring feature flag.
 */
@Module({
  controllers: [HealthController],
  providers: [GovernanceAuthoringConfig],
})
export class HealthModule {}
