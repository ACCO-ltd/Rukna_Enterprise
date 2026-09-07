import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { AccountingReadinessService } from '../application/accounting-readiness.service.js';

/**
 * Whether the ledger can accept a posting yet.
 *
 * Gated on `view:accounting`, not `manage:accounting`: a project manager reading a Finance
 * screen needs to know why a figure is unavailable, and making that answer require the
 * permission to *change* the chart of accounts would leave them looking at a blank number
 * with no explanation.
 */
@ApiTags('Accounting Configuration')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingView)
@Controller('accounting')
export class AccountingReadinessController {
  constructor(private readonly readiness: AccountingReadinessService) {}

  @Get('readiness')
  @ApiOperation({
    summary: 'Can the general ledger accept a posting, and what is missing if not',
    description:
      'Checks only what the posting path actually dereferences: the chart of accounts and ' +
      'its control-account roles, an open period covering today, expense posting profiles ' +
      'and document numbering. Lets a screen say "Unavailable, and here is why" instead of ' +
      'rendering a zero it cannot defend.',
  })
  getReadiness(@CurrentUser() identity: RequestIdentity) {
    return this.readiness.getReadiness(identity);
  }
}
