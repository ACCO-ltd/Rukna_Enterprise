import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PermissionsService } from '../application/permissions.service.js';

@ApiTags('Permissions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.permissionsView)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all platform permissions' })
  @ApiResponse({ status: 200, description: 'Array of permission strings (format: action:resource)' })
  findAll() {
    return this.permissionsService.findAll();
  }
}
