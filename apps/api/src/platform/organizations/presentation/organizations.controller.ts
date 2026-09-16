import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { OrganizationsService } from '../application/organizations.service.js';
import { UpdateOrganizationBrandingDto } from './dto/update-organization-branding.dto.js';

@ApiTags('Organizations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.organizationsView)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get an organization by ID' })
  @ApiParam({ name: 'id', description: 'Organization CUID' })
  @ApiResponse({ status: 200, description: 'Organization record' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.organizationsService.findById(id, identity.activeOrganizationId);
  }

  @Patch(':id/branding')
  @RequirePermissions(PERMISSIONS.organizationsManage)
  @ApiOperation({ summary: 'Update invoice branding: logo, address, tax ID, color, template' })
  @ApiParam({ name: 'id', description: 'Organization CUID' })
  @ApiResponse({ status: 200, description: 'Updated organization record' })
  @ApiResponse({ status: 403, description: 'Not this organization, or missing manage:organization' })
  updateBranding(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationBrandingDto,
  ) {
    return this.organizationsService.updateBranding(id, identity.activeOrganizationId, dto);
  }
}
