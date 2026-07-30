import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { AuditLogsService } from '../application/audit-logs.service.js';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  findByOrg(@Query('orgId') orgId: string) {
    return this.auditLogsService.findByOrg(orgId);
  }
}
