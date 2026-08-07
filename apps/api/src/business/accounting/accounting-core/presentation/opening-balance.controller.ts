import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { OpeningBalanceService } from '../application/opening-balance.service.js';
import { RunOpeningBalanceDto } from './dto/run-opening-balance.dto.js';

@ApiTags('Opening Balance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('accounting/opening-balance')
export class OpeningBalanceController {
  constructor(private readonly openingBalanceService: OpeningBalanceService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run opening balance migration wizard',
    description:
      'Idempotent. Posts a SYSTEM_OPENING journal from the trial balance, ' +
      'imports open AR invoices and AP bills with OPENING_BALANCE posting status, ' +
      'and returns a reconciliation report.',
  })
  @ApiResponse({ status: 200, description: 'Migration report with reconciliation check' })
  @ApiResponse({ status: 409, description: 'Opening balance already posted for this organization' })
  run(@CurrentUser() identity: RequestIdentity, @Body() dto: RunOpeningBalanceDto) {
    return this.openingBalanceService.runWizard(identity, dto);
  }
}
