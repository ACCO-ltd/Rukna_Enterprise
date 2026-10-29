import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { AuditLogsService } from '../application/audit-logs.service.js';
import { AuditLogQueryDto } from './dto/audit-log-query.dto.js';

@ApiTags('Audit Logs')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.auditLogsView)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: 'One page of the caller\'s organization audit trail, newest first' })
  @ApiResponse({ status: 200, description: 'AuditLogPage: items (with the person named), total, page, pageSize, facets' })
  findPage(@CurrentUser() identity: RequestIdentity, @Query() query: AuditLogQueryDto) {
    return this.auditLogsService.findPage(identity.activeOrganizationId, query);
  }
}
