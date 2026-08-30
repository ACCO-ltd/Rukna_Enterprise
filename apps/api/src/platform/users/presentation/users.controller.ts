import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
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
import { UsersService } from '../application/users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { SetUserPasswordDto } from './dto/set-user-password.dto.js';
import { SetUserRolesDto } from './dto/set-user-roles.dto.js';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.usersView)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: "List users in the caller's organization with roles + status" })
  @ApiResponse({ status: 200, description: 'Array of users with roles and membership status' })
  findByOrganization(@CurrentUser() identity: RequestIdentity) {
    return this.usersService.findByOrganization(identity.activeOrganizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.usersManage)
  @ApiOperation({ summary: 'Create a user with an ACTIVE membership and assigned roles' })
  @ApiResponse({ status: 201, description: 'User created with roles' })
  @ApiResponse({ status: 400, description: 'Password too short or invalid roleIds' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateUserDto) {
    return this.usersService.create(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID with roles + membership status' })
  @ApiParam({ name: 'id', description: 'User CUID' })
  @ApiResponse({ status: 200, description: 'User with roles' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.usersService.findByIdWithRoles(id, identity.activeOrganizationId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.usersManage)
  @ApiOperation({ summary: 'Update a user profile (firstName / lastName)' })
  @ApiParam({ name: 'id', description: 'User CUID' })
  update(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(identity, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.usersManage)
  @ApiOperation({ summary: 'Deactivate a user and suspend their membership' })
  @ApiParam({ name: 'id', description: 'User CUID' })
  @ApiResponse({ status: 400, description: 'Cannot deactivate your own account' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.usersService.deactivate(identity, id);
  }

  @Post(':id/reactivate')
  @RequirePermissions(PERMISSIONS.usersManage)
  @ApiOperation({ summary: 'Reactivate a user and restore their membership' })
  @ApiParam({ name: 'id', description: 'User CUID' })
  reactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.usersService.reactivate(identity, id);
  }

  @Post(':id/set-password')
  @RequirePermissions(PERMISSIONS.usersManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Admin-set a new password for a user' })
  @ApiParam({ name: 'id', description: 'User CUID' })
  @ApiResponse({ status: 204, description: 'Password updated' })
  @ApiResponse({ status: 400, description: 'Password too short' })
  setPassword(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: SetUserPasswordDto,
  ) {
    return this.usersService.setPassword(identity, id, dto);
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSIONS.usersManage)
  @ApiOperation({ summary: "Replace the user's role set on their membership" })
  @ApiParam({ name: 'id', description: 'User CUID' })
  @ApiResponse({ status: 400, description: 'One or more roleIds invalid for this organization' })
  setRoles(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: SetUserRolesDto,
  ) {
    return this.usersService.setRoles(identity, id, dto);
  }
}
