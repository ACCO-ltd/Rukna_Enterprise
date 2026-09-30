import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { PostingProfileService } from '../application/posting-profile.service.js';
import { CreatePostingProfileDto, RepointPostingProfileDto } from './dto/posting-profile.dto.js';

/**
 * Posting profiles — the code a supplier bill line names, mapped to the GL account it posts to.
 *
 * Reading stays open to AP (bill entry picks from the list) and is extended to accounting
 * viewers (the posting-profiles screen). Managing — ADR-040 §4 — is `manage:accounting`.
 */
@ApiTags('Posting Profiles')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('posting-profiles')
export class PostingProfileController {
  constructor(private readonly profiles: PostingProfileService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.payablesManage, PERMISSIONS.accountingView)
  @ApiOperation({ summary: 'List posting profiles with their version history and current account' })
  @ApiQuery({ name: 'status', enum: ['ACTIVE', 'INACTIVE'], required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('status') status?: 'ACTIVE' | 'INACTIVE',
  ) {
    return this.profiles.list(identity, status === 'ACTIVE' || status === 'INACTIVE' ? status : undefined);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Create a posting profile (409 POSTING_PROFILE_CODE_TAKEN, 400 POSTING_PROFILE_ACCOUNT_INVALID)' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreatePostingProfileDto) {
    return this.profiles.create(identity, dto);
  }

  @Post(':id/versions')
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Re-point a profile from a date (new version; the previous one is closed, not replaced)' })
  repoint(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: RepointPostingProfileDto,
  ) {
    return this.profiles.repoint(identity, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Deactivate a profile (bill lines can no longer name it)' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.profiles.setActive(identity, id, false);
  }

  @Post(':id/reactivate')
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reactivate a deactivated profile' })
  reactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.profiles.setActive(identity, id, true);
  }
}
