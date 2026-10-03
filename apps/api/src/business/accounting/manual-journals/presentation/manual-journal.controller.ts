import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { ManualJournalService } from '../application/manual-journal.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { CreateManualJournalDto } from './dto/create-manual-journal.dto.js';
import { ApproveManualJournalDto } from './dto/approve-manual-journal.dto.js';
import { ReverseManualJournalDto } from './dto/reverse-manual-journal.dto.js';

@ApiTags('Manual Journals')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.journalsManage)
@Controller('journals')
export class ManualJournalController {
  constructor(
    private readonly manualJournalService: ManualJournalService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all manual journal entries for the organization' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Journals with any line coded to the project' })
  async findAll(@CurrentUser() identity: RequestIdentity, @Query('projectId') projectId?: string) {
    // ADR-043: a project filter respects project access (404 outside the org, 403 non-member).
    if (projectId) await this.projectAccess.assertMember(identity, projectId);
    return this.manualJournalService.findAll(identity, projectId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a journal entry in DRAFT status' })
  @ApiResponse({ status: 201, description: 'Journal created' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateManualJournalDto) {
    return this.manualJournalService.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get journal entry with lines' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.manualJournalService.findById(identity, id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Submit journal for CFO approval: DRAFT → PENDING_APPROVAL' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.manualJournalService.submit(identity, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'CFO approves or rejects the journal' })
  @ApiResponse({ status: 400, description: 'Journal is not in PENDING_APPROVAL status' })
  approve(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ApproveManualJournalDto,
  ) {
    return this.manualJournalService.approve(identity, { journalId: id, ...dto });
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Post approved journal to the GL: APPROVED → POSTED' })
  @ApiResponse({ status: 400, description: 'Journal must be APPROVED before posting' })
  post(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.manualJournalService.post(identity, id);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reverse a posted journal entry (CFO-approved)' })
  @ApiResponse({ status: 400, description: 'Only POSTED journals can be reversed' })
  reverse(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ReverseManualJournalDto,
  ) {
    return this.manualJournalService.reverse(identity, { journalId: id, ...dto });
  }
}
