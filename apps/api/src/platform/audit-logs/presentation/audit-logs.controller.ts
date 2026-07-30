import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { AuditLogsService } from '../application/audit-logs.service.js';

@ApiTags('Audit Logs')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List all audit log entries for an organization' })
  @ApiQuery({ name: 'orgId', description: 'Organization CUID', required: true })
  @ApiResponse({ status: 200, description: 'Array of immutable audit log entries' })
  findByOrg(@Query('orgId') orgId: string) {
    return this.auditLogsService.findByOrg(orgId);
  }
}
