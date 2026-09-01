import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';
import { GovernanceAuthoringConfig } from '../workflows/application/governance-authoring.config.js';

/**
 * Liveness probe for the deployment platform.
 *
 * Deliberately tenant-free: it is excluded from TenancyMiddleware in
 * AppModule and touches no database, so a probe never depends on tenant
 * resolution or on any tenant DB being reachable.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly authoring: GovernanceAuthoringConfig) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe — returns 200 when the process is serving' })
  check(): { status: string; uptime: number; capabilities: { governanceAuthoringEnabled: boolean } } {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      // ADR-027 rollout: the process-level authoring feature flag, exposed so the web can hide the
      // policy-authoring affordances when it is off. This is a process capability, not tenant data,
      // which is why it rides on the tenant-free liveness read. The API remains the boundary — the
      // authoring write endpoints 403 regardless of what the UI renders.
      capabilities: { governanceAuthoringEnabled: this.authoring.isEnabled() },
    };
  }
}
