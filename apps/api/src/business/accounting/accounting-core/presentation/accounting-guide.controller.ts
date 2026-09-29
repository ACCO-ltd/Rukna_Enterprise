import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { AccountingGuideService } from '../application/accounting-guide.service.js';

/**
 * The Accounting "Get started" guide read-model.
 *
 * Gated on `view:accounting` (not manage): a finance officer who can only prepare, and a CFO who
 * approves, both need to see where they are in each cycle. The steps come back permission-aware —
 * anything the caller cannot do is RESTRICTED — so the same payload drives every role's view.
 */
@ApiTags('Accounting Configuration')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingView)
@Controller('accounting')
export class AccountingGuideController {
  constructor(private readonly guide: AccountingGuideService) {}

  @Get('guide')
  @ApiOperation({
    summary: 'Guided finance flow — setup, daily, month-end and year-end cycle state',
    description:
      'Live read-model for the Get-started hub and cycle-status strip. Setup reuses the readiness ' +
      'checks; daily/month-end/year-end are derived from document counts and period/fiscal-year ' +
      'state. Steps the caller cannot perform are RESTRICTED.',
  })
  getGuide(@CurrentUser() identity: RequestIdentity) {
    return this.guide.getGuide(identity);
  }
}
