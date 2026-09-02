import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProjectSubtypeService } from '../application/project-subtype.service.js';
import {
  CreateProjectSubtypeDto,
  ListProjectSubtypesQueryDto,
} from './dto/project-subtype.dto.js';

// Project type (PTD1-PTD5): the subtype registry. Reads are open to anyone who can view projects
// (the create/edit-project form needs the picker), mirroring the District registry; writes are gated
// on manage:project-type (a Settings/admin capability).
@ApiTags('Project Subtypes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.projectsView)
@Controller('project-subtypes')
export class ProjectSubtypeController {
  constructor(private readonly service: ProjectSubtypeService) {}

  @Get()
  @ApiOperation({
    summary: 'List project subtypes. Filter by ?category= and ?activeOnly=true for the picker.',
  })
  @ApiQuery({ name: 'category', required: false, description: 'Filter to a single ProjectCategory' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  list(
    @CurrentUser() identity: RequestIdentity,
    @Query() query: ListProjectSubtypesQueryDto,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.service.list(identity, {
      category: query.category,
      activeOnly: activeOnly === 'true',
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.projectTypeManage)
  @ApiOperation({ summary: 'Add a subtype to a category' })
  @ApiResponse({ status: 409, description: 'A subtype with this name already exists in the category' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateProjectSubtypeDto) {
    return this.service.create(identity, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.projectTypeManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Deactivate a subtype (hides it from new-project pickers; keeps history)' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.deactivate(identity, id);
  }
}
