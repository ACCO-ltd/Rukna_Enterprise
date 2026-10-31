import {
  Controller, Get, Post, Patch, Body, Param, Query,
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
import { CancelManualJournalDto } from './dto/cancel-manual-journal.dto.js';

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

  // Declared before `:id` so the path is not read as a journal id.
  @Get('entries')
  @ApiOperation({ summary: 'Every posted entry dated in the range, whatever posted it (the day book)' })
  @ApiQuery({ name: 'fromDate', required: true, example: '2026-10-01' })
  @ApiQuery({ name: 'toDate', required: true, example: '2026-10-31' })
  entries(@CurrentUser() identity: RequestIdentity, @Query('fromDate') fromDate: string, @Query('toDate') toDate: string) {
    return this.manualJournalService.entries(identity, fromDate, toDate);
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

  @Patch(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Edit a DRAFT journal, or correct a REJECTED one (returns it to DRAFT). Preparer only.' })
  update(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: CreateManualJournalDto) {
    return this.manualJournalService.update(identity, id, dto);
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

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Cancel a journal that has not posted (draft, waiting, approved or returned)' })
  @ApiResponse({ status: 409, description: 'The journal is posted (reverse it) or already cancelled' })
  cancel(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: CancelManualJournalDto) {
    return this.manualJournalService.cancel(identity, id, dto.reason);
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
