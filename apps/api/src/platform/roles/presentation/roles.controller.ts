import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesService } from '../application/roles.service.js';

@ApiTags('Roles')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List all roles for an organization' })
  @ApiQuery({ name: 'orgId', description: 'Organization CUID', required: true })
  @ApiResponse({ status: 200, description: 'Array of roles' })
  findAll(@Query('orgId') orgId: string) {
    return this.rolesService.findAll(orgId);
  }
}
