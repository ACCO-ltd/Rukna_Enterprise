import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { OrganizationsService } from '../application/organizations.service.js';

@ApiTags('Organizations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get an organization by ID' })
  @ApiParam({ name: 'id', description: 'Organization CUID' })
  @ApiResponse({ status: 200, description: 'Organization record' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  findById(@Param('id') id: string) {
    return this.organizationsService.findById(id);
  }
}
