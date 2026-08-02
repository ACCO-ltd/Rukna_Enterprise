import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { ProjectService } from '../application/project.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { CancelProjectDto } from './dto/cancel-project.dto.js';
import { SuspendProjectDto } from './dto/suspend-project.dto.js';
import { AddMemberDto } from './dto/add-member.dto.js';

@ApiTags('Projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectService: ProjectService) {}

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List projects for the authenticated organization' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by ProjectStatus' })
  findAll(@CurrentUser() identity: RequestIdentity, @Query('status') status?: string) {
    return this.projectService.findAll(identity, status);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new project in DRAFT status' })
  @ApiResponse({ status: 201, description: 'Project created' })
  @ApiResponse({ status: 409, description: 'Project code already exists' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateProjectDto) {
    return this.projectService.create(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project details including active members and suspension' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.findOne(identity, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update project (DRAFT status only)' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  update(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectService.update(identity, id, dto);
  }

  // ─── Lifecycle commands ───────────────────────────────────────────────────────

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition project from DRAFT → APPROVED' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.transition(identity, id, 'approve');
  }

  @Post(':id/mobilize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition project from APPROVED → MOBILIZING' })
  mobilize(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.transition(identity, id, 'mobilize');
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition project from MOBILIZING → ACTIVE' })
  activate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.transition(identity, id, 'activate');
  }

  @Post(':id/practical-completion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition project from ACTIVE → PRACTICAL_COMPLETION' })
  practicalCompletion(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.transition(identity, id, 'practical-completion');
  }

  @Post(':id/closeout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition project from PRACTICAL_COMPLETION → CLOSEOUT' })
  closeout(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.transition(identity, id, 'closeout');
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition project from CLOSEOUT → CLOSED' })
  close(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.transition(identity, id, 'close');
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel project (allowed from DRAFT, APPROVED, MOBILIZING, ACTIVE)' })
  @ApiResponse({ status: 400, description: 'Project cannot be cancelled from current status' })
  cancel(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: CancelProjectDto,
  ) {
    return this.projectService.cancel(identity, id, dto.reason);
  }

  // ─── Suspension ──────────────────────────────────────────────────────────────

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend project — blocks lifecycle transitions' })
  @ApiResponse({ status: 409, description: 'Project already has an active suspension' })
  suspend(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: SuspendProjectDto,
  ) {
    return this.projectService.suspend(identity, id, dto.reason);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a suspended project' })
  @ApiResponse({ status: 400, description: 'No active suspension to resume' })
  resume(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.resume(identity, id);
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  @Get(':id/members')
  @ApiOperation({ summary: 'List active project members with their roles' })
  listMembers(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.projectService.listMembers(identity, id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a user to the project with one or more roles' })
  @ApiResponse({ status: 409, description: 'User is already an active member' })
  addMember(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.projectService.addMember(identity, id, dto);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a user from the project (soft-delete)' })
  removeMember(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.projectService.removeMember(identity, id, userId);
  }
}
