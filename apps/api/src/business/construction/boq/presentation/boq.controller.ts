import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { BoqVersioningService } from '../application/boq-versioning.service.js';
import { BoqTreeService } from '../application/boq-tree.service.js';
import { CreateDraftDto } from './dto/create-draft.dto.js';
import { CreateNodeDto } from './dto/create-node.dto.js';
import { UpdateNodeDto } from './dto/update-node.dto.js';
import { MoveNodeDto } from './dto/move-node.dto.js';

@ApiTags('BOQ')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@RequirePermissions(PERMISSIONS.boqView)
@ProjectScoped()
@Controller('projects/:projectId/boq')
export class BoqController {
  constructor(
    private readonly versioningService: BoqVersioningService,
    private readonly treeService: BoqTreeService,
  ) {}

  // ─── BOQ lifecycle ────────────────────────────────────────────────────────────

  @Post()
  @RequirePermissions(PERMISSIONS.boqManage)
  @ApiOperation({ summary: 'Initialize BOQ for a project (idempotent — returns existing if already initialized)' })
  @ApiParam({ name: 'projectId' })
  initialize(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.versioningService.initialize(identity, projectId);
  }

  @Get()
  @ApiOperation({ summary: 'Get BOQ summary with all version metadata' })
  @ApiParam({ name: 'projectId' })
  getBoq(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.versioningService.getBoq(identity, projectId);
  }

  @Post('draft')
  @RequirePermissions(PERMISSIONS.boqManage)
  @ApiOperation({ summary: 'Create a new DRAFT version from the current approved version' })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 409, description: 'Draft already exists — baseline or cancel it first' })
  createDraft(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: CreateDraftDto,
  ) {
    return this.versioningService.createDraftFromApproved(identity, projectId, dto.notes);
  }

  // ─── Version commands ─────────────────────────────────────────────────────────

  @Post('versions/:versionId/baseline')
  @RequirePermissions(PERMISSIONS.boqBaseline)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Baseline the current DRAFT version → BASELINED. Sets it as the approved version.' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  @ApiResponse({ status: 400, description: 'Version is not the current draft or not in DRAFT status' })
  baseline(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versioningService.baseline(identity, projectId, versionId);
  }

  @Post('versions/:versionId/cancel')
  @RequirePermissions(PERMISSIONS.boqManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel the current DRAFT version — does not affect the approved version' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  cancelDraft(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versioningService.cancelDraft(identity, projectId, versionId);
  }

  // ─── Tree operations ──────────────────────────────────────────────────────────

  @Get('versions/:versionId/tree')
  @ApiOperation({ summary: 'Get the full BOQ tree for a version with computed totals' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  getTree(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.treeService.getTree(identity, projectId, versionId);
  }

  @Post('versions/:versionId/nodes')
  @RequirePermissions(PERMISSIONS.boqManage)
  @ApiOperation({ summary: 'Add a node to the BOQ tree (DRAFT only)' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  addNode(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() dto: CreateNodeDto,
  ) {
    return this.treeService.addNode(identity, projectId, versionId, dto);
  }

  @Patch('versions/:versionId/nodes/:nodeId')
  @RequirePermissions(PERMISSIONS.boqManage)
  @ApiOperation({ summary: 'Update node description, quantities, or rates (DRAFT only)' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  @ApiParam({ name: 'nodeId' })
  updateNode(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateNodeDto,
  ) {
    return this.treeService.updateNode(identity, projectId, versionId, nodeId, dto);
  }

  @Post('versions/:versionId/nodes/:nodeId/move')
  @RequirePermissions(PERMISSIONS.boqManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a node (and all its descendants) to a new position (DRAFT only)' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  @ApiParam({ name: 'nodeId' })
  @ApiResponse({ status: 400, description: 'Circular move or target is a leaf node' })
  moveNode(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: MoveNodeDto,
  ) {
    return this.treeService.moveNode(identity, projectId, versionId, nodeId, dto);
  }

  @Delete('versions/:versionId/nodes/:nodeId')
  @RequirePermissions(PERMISSIONS.boqManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a leaf node (DRAFT only — must have no children)' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  @ApiParam({ name: 'nodeId' })
  @ApiResponse({ status: 400, description: 'Node has children — delete or re-parent them first' })
  deleteNode(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.treeService.deleteNode(identity, projectId, versionId, nodeId);
  }
}
