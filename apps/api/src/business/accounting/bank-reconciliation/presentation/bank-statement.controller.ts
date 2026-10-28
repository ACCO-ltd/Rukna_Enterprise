import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { BankReconciliationService } from '../application/bank-reconciliation.service.js';
import { ImportBankStatementDto, MatchStatementLineDto, PostStatementLineDto } from './bank-statement.dto.js';

/**
 * Step 6 — bank reconciliation. Reading is for whoever reads the accounts; importing, matching,
 * posting a charge and reconciling are `manage:accounting`.
 */
@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('finance/bank-statements')
export class BankStatementController {
  constructor(private readonly service: BankReconciliationService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Imported bank statements, newest first' })
  list(@CurrentUser() identity: RequestIdentity, @Query('bankAccountId') bankAccountId?: string) {
    return this.service.list(identity, bankAccountId || undefined);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Import a statement; it must add up (opening + lines = closing)' })
  import(@CurrentUser() identity: RequestIdentity, @Body() dto: ImportBankStatementDto) {
    return this.service.import(identity, dto);
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'The statement with its lines, match suggestions, uncleared ledger lines and the reconciliation' })
  workspace(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.workspace(identity, id);
  }

  @Post(':id/accept-suggestions')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Accept every unambiguous match suggestion' })
  acceptSuggestions(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.acceptSuggestions(identity, id);
  }

  @Post(':id/lines/:lineId/match')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Match a statement line to a ledger line of the same amount on this bank account' })
  match(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: MatchStatementLineDto) {
    return this.service.match(identity, id, lineId, dto.journalLineId);
  }

  @Post(':id/lines/:lineId/unmatch')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Undo a match (a posted line is undone by reversing its journal)' })
  unmatch(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.service.unmatch(identity, id, lineId);
  }

  @Post(':id/lines/:lineId/post')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Post a charge or interest from the line: the bank against the chosen account' })
  postLine(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: PostStatementLineDto) {
    return this.service.postLine(identity, id, lineId, dto);
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Reconcile: every line matched and the balances agree; the statement then freezes' })
  reconcile(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.reconcileStatement(identity, id);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Remove an open statement imported by mistake (nothing posted from it)' })
  async remove(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    await this.service.remove(identity, id);
    return { removed: true };
  }
}
