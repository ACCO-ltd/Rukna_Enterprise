import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { AuditLogsService } from '../application/audit-logs.service.js';

@ApiTags('Audit Logs')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.auditLogsView)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List all audit log entries for the caller\'s organization' })
  @ApiResponse({ status: 200, description: 'Array of immutable audit log entries' })
  findByOrg(@CurrentUser() identity: RequestIdentity) {
    return this.auditLogsService.findByOrg(identity.activeOrganizationId);
  }
}
