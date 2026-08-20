import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { DistrictService } from '../application/district.service.js';
import { CreateDistrictDto, UpdateDistrictDto } from './dto/district.dto.js';

// ADR-025: district registry. Reads are open to anyone who can view projects (the create-project
// form needs the picker); writes are gated on manage:district (a settings/admin capability).
@ApiTags('Districts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.projectsView)
@Controller('districts')
export class DistrictController {
  constructor(private readonly service: DistrictService) {}

  @Get()
  @ApiOperation({ summary: 'List districts. Pass activeOnly=true for the project-create picker.' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  list(
    @CurrentUser() identity: RequestIdentity,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.service.list(identity, activeOnly === 'true');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.districtsManage)
  @ApiOperation({ summary: 'Add a district (code is immutable once created)' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateDistrictDto) {
    return this.service.create(identity, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.districtsManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Rename or (de)activate a district. The code cannot change.' })
  update(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateDistrictDto,
  ) {
    return this.service.update(identity, id, dto);
  }
}
