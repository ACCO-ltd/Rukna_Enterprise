import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import type { RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { UsersService } from '../application/users.service.js';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users in the caller\'s organization' })
  @ApiResponse({ status: 200, description: 'Array of user records' })
  findByOrganization(@CurrentUser() identity: RequestIdentity) {
    return this.usersService.findByOrganization(identity.activeOrganizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', description: 'User CUID' })
  @ApiResponse({ status: 200, description: 'User record' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
