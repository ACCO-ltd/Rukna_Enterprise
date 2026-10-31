import { Controller, Get, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { ReconciliationService } from '../application/reconciliation.service.js';
import { RunReconciliationDto } from './dto/run-reconciliation.dto.js';

@ApiTags('Reconciliation')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingManage)
@Controller('accounting/reconcile')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get()
  @ApiOperation({ summary: 'Do the receivable and payable control accounts agree with open invoices and bills today?' })
  current(@CurrentUser() identity: RequestIdentity) {
    return this.reconciliationService.runFullReconciliation(identity);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run full control account reconciliation',
    description:
      'Compares AR/AP GL balances (signed, on their own side) against open documents. ' +
      'A difference above 0.01 flags as unreconciled. Codes are optional: control accounts are found from the chart.',
  })
  @ApiResponse({ status: 200, description: 'Reconciliation report' })
  run(@CurrentUser() identity: RequestIdentity, @Body() dto: RunReconciliationDto) {
    return this.reconciliationService.runFullReconciliation(identity, dto);
  }
}
