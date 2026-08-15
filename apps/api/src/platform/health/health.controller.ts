import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';

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
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe — returns 200 when the process is serving' })
  check(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }
}
