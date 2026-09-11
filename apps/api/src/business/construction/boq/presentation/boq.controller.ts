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
  Redirect,
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
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { BoqVersioningService } from '../application/boq-versioning.service.js';
import { BoqTreeService } from '../application/boq-tree.service.js';
import { BoqWorkspaceService } from '../application/boq-workspace.service.js';
import { BoqImportService } from '../application/boq-import.service.js';
import { CreateDraftDto } from './dto/create-draft.dto.js';
import { CreateNodeDto } from './dto/create-node.dto.js';
import { UpdateNodeDto } from './dto/update-node.dto.js';
import { MoveNodeDto } from './dto/move-node.dto.js';
import { ImportBoqDto } from './dto/import-boq.dto.js';
import { DrawContingencyDto } from './dto/draw-contingency.dto.js';

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
    private readonly workspaceService: BoqWorkspaceService,
    private readonly importService: BoqImportService,
  ) {}

  // ─── Workspace read models ────────────────────────────────────────────────────

  @Get('workspace')
  @ApiOperation({
    summary:
      'Everything the BOQ workspace needs in one response: versions, totals, contract baseline, readiness, capabilities',
  })
  @ApiParam({ name: 'projectId' })
  workspace(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.workspaceService.getWorkspace(identity, projectId);
  }

  @Get('compare-to-signed')
  // ADR-029 R-2 — the meaningful diff: the live operational version vs the frozen as-committed
  // SNAPSHOT, classifying each change money-neutral vs value-changing. Replaces peer-version compare.
  @ApiOperation({
    summary:
      'Diff the live BOQ against the as-committed (signed) snapshot; empty until the BOQ is committed',
  })
  @ApiParam({ name: 'projectId' })
  compareToSigned(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
  ) {
    return this.workspaceService.compareToSigned(identity, projectId);
  }

  @Get('timeline')
  // ADR-029 R-3 — the BOQ's notable events (commit, variation adopts, notable line changes),
  // newest-first, with tier-gated amounts.
  @ApiOperation({ summary: 'The BOQ timeline: commit, variation snapshots and notable changes, newest-first' })
  @ApiParam({ name: 'projectId' })
  timeline(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.workspaceService.timeline(identity, projectId);
  }

  @Get('versions/:leftId/compare/:rightId')
  @ApiOperation({ summary: 'Diff two versions, paired on originNodeId lineage' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'leftId', description: 'The older version' })
  @ApiParam({ name: 'rightId', description: 'The newer version' })
  compare(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('leftId') leftId: string,
    @Param('rightId') rightId: string,
  ) {
    return this.workspaceService.compare(identity, projectId, leftId, rightId);
  }

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

  @Post('import/preview')
  @RequirePermissions(PERMISSIONS.boqManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dry-run an import: what it would create + every finding, without committing',
  })
  @ApiParam({ name: 'projectId' })
  previewImport(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: ImportBoqDto,
  ) {
    return this.importService.preview(identity, projectId, dto);
  }

  @Post('import')
  @RequirePermissions(PERMISSIONS.boqManage)
  @ApiOperation({
    summary: 'Bulk-import mapped spreadsheet rows into the DRAFT (creates BOQ/draft if needed)',
  })
  @ApiParam({ name: 'projectId' })
  @ApiResponse({ status: 400, description: 'Blocking violations — nothing was created' })
  @ApiResponse({ status: 409, description: 'No editable draft, or a Replace would strand a reference' })
  importBoq(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: ImportBoqDto,
  ) {
    return this.importService.import(identity, projectId, dto);
  }

  @Get('versions/:versionId/history')
  @ApiOperation({ summary: 'The version change log (newest first); optional ?nodeId= narrows to one line' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  getHistory(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Query('nodeId') nodeId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.treeService.getHistory(identity, projectId, versionId, {
      ...(nodeId ? { nodeId } : {}),
      take: Math.min(200, Math.max(1, take ? parseInt(take, 10) || 100 : 100)),
      skip: skip ? Math.max(0, parseInt(skip, 10) || 0) : 0,
    });
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

  @Get('versions/:versionId/readiness')
  @ApiOperation({
    summary: 'Baseline readiness for a version — the same evaluation POST /baseline enforces',
  })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  readiness(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versioningService.getReadiness(identity, projectId, versionId);
  }

  @Get('versions/:versionId/contingency')
  // ADR-029 CONST-BOQ-028 / spec C-2 — contingency remaining, derived from the live allowance
  // leaves. Read behind the base `view:boq`; the tiered money-visibility redaction is R10.
  @ApiOperation({ summary: 'Contingency remaining on a version (derived, decimal string)' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  contingency(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versioningService.getContingencyRemaining(identity, projectId, versionId);
  }

  @Post('versions/:versionId/contingency/draw')
  // ADR-029 CONST-BOQ-028 / spec C-3, A-4 — drawing down the allowance is a commercial-authority act.
  @RequirePermissions(PERMISSIONS.boqManageContingency)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Draw budget from the contingency allowance onto a target item, keeping the contract value constant.',
  })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  @ApiResponse({
    status: 400,
    description:
      'Over-draw (errorCode CONTINGENCY_EXCEEDED), no/ambiguous contingency line, or a target that would take a distorted rate',
  })
  drawContingency(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() dto: DrawContingencyDto,
  ) {
    return this.treeService.drawContingency(
      identity,
      projectId,
      versionId,
      dto.toNodeId,
      dto.amount,
    );
  }

  @Post('versions/:versionId/commit')
  // ADR-029 CONST-BOQ-034 — commit-to-contract governs DRAFT → COMMITTED (replaces baseline).
  @RequirePermissions(PERMISSIONS.boqCommit)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Commit the operational DRAFT version to contract → COMMITTED, freezing an as-committed SNAPSHOT copy.',
  })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  @ApiResponse({
    status: 400,
    description:
      'Not the operational version, not DRAFT, or not ready to commit — details.blockers lists why',
  })
  @ApiResponse({
    status: 409,
    description: 'Approval required — details.approvalInstanceId identifies the instance',
  })
  commit(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versioningService.commit(identity, projectId, versionId);
  }

  // ADR-029 M-5 / BOUND-002 — the old baseline route is retained for one release and 308-redirects
  // to commit (a 308 preserves the POST method and empty body). New clients call /commit directly.
  @Post('versions/:versionId/baseline')
  @RequirePermissions(PERMISSIONS.boqCommit)
  @Redirect(undefined, HttpStatus.PERMANENT_REDIRECT)
  @ApiOperation({ summary: 'Deprecated — 308-redirects to POST …/commit.' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  baseline(
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ): { url: string; statusCode: number } {
    return {
      url: `/projects/${projectId}/boq/versions/${versionId}/commit`,
      statusCode: HttpStatus.PERMANENT_REDIRECT,
    };
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
  // ADR-029 §8 A-1 — a BOQ edit is authorized by edit-scope OR edit-cost OR the manage umbrella.
  @RequireAnyPermission(PERMISSIONS.boqEditScope, PERMISSIONS.boqEditCost, PERMISSIONS.boqManage)
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
  @RequireAnyPermission(PERMISSIONS.boqEditScope, PERMISSIONS.boqEditCost, PERMISSIONS.boqManage)
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
  @RequireAnyPermission(PERMISSIONS.boqEditScope, PERMISSIONS.boqEditCost, PERMISSIONS.boqManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Move a node and its descendants to a new position (DRAFT only). Returns the reindexed tree.',
  })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  @ApiParam({ name: 'nodeId' })
  @ApiResponse({ status: 400, description: 'Circular move, target is an item, or depth exceeded' })
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
  @RequireAnyPermission(PERMISSIONS.boqEditScope, PERMISSIONS.boqEditCost, PERMISSIONS.boqManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a node (DRAFT only — must have no children and no references)' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'versionId' })
  @ApiParam({ name: 'nodeId' })
  @ApiResponse({ status: 400, description: 'Node has children — delete or re-parent them first' })
  @ApiResponse({
    status: 409,
    description:
      'Referenced by downstream records (CONST-BOQ-003) — details.references lists them. Deactivate instead.',
  })
  deleteNode(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.treeService.deleteNode(identity, projectId, versionId, nodeId);
  }
}
