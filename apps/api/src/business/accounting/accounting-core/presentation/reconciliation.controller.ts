import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { ReconciliationService } from '../application/reconciliation.service.js';
import { RunReconciliationDto } from './dto/run-reconciliation.dto.js';

@ApiTags('Reconciliation')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('accounting/reconcile')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run full control account reconciliation',
    description:
      'Compares AR/AP GL balances against subledger totals. ' +
      'Variance > 0.01 flags as unreconciled. Required before period close.',
  })
  @ApiResponse({ status: 200, description: 'Reconciliation report' })
  run(@CurrentUser() identity: RequestIdentity, @Body() dto: RunReconciliationDto) {
    return this.reconciliationService.runFullReconciliation(identity, dto);
  }
}
