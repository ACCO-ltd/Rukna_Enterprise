import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { RolesService } from '../application/roles.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto.js';
import { ReassignRoleOwnerDto } from './dto/reassign-role-owner.dto.js';
import { CreateRoleAccessReviewDto } from './dto/create-role-access-review.dto.js';

@ApiTags('Roles')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.rolesView)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: "List roles for the caller's organization with aggregates" })
  @ApiResponse({ status: 200, description: 'Array of role summaries (permission + member counts)' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.rolesService.findAll(identity.activeOrganizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.rolesManage)
  @ApiOperation({ summary: 'Create a role with an optional permission set' })
  @ApiResponse({ status: 201, description: 'Role created with permissions' })
  @ApiResponse({ status: 400, description: 'Invalid permissionIds' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a role with its permissions' })
  @ApiParam({ name: 'id', description: 'Role CUID' })
  @ApiResponse({ status: 200, description: 'Role with permissions' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.rolesService.findOne(identity.activeOrganizationId, id);
  }

  @Get(':id/impact')
  impact(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) { return this.rolesService.impact(identity.activeOrganizationId, id); }

  @Get(':id/access-reviews')
  reviews(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) { return this.rolesService.reviewHistory(identity.activeOrganizationId, id); }

  @Post(':id/access-reviews')
  @RequirePermissions(PERMISSIONS.rolesManage)
  review(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: CreateRoleAccessReviewDto) { return this.rolesService.review(identity, id, dto); }

  @Post(':id/owner')
  @RequirePermissions(PERMISSIONS.rolesManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  reassignOwner(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ReassignRoleOwnerDto) { return this.rolesService.reassignOwner(identity, id, dto.ownerUserId); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.rolesManage)
  @ApiOperation({ summary: 'Update a role (name / description)' })
  @ApiParam({ name: 'id', description: 'Role CUID' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  update(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.update(identity, id, dto);
  }

  @Put(':id/permissions')
  @RequirePermissions(PERMISSIONS.rolesManage)
  @ApiOperation({ summary: "Replace the role's permission set" })
  @ApiParam({ name: 'id', description: 'Role CUID' })
  @ApiResponse({ status: 400, description: 'Invalid permissionIds' })
  setPermissions(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rolesService.setPermissions(identity, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.rolesManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role (blocked if in use or the ADMIN role)' })
  @ApiParam({ name: 'id', description: 'Role CUID' })
  @ApiResponse({ status: 204, description: 'Role deleted' })
  @ApiResponse({ status: 409, description: 'Role is in use or is the ADMIN role' })
  remove(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.rolesService.remove(identity, id);
  }
}
