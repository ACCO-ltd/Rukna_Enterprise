import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { SentBackService } from '../application/sent-back.service.js';

/** Step 7 — the phone Home's "sent back" list, for whoever collects quotes and receipts. */
@ApiTags('Procurement')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('procurement/sent-back')
export class SentBackController {
  constructor(private readonly service: SentBackService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.procurementView, PERMISSIONS.quotationsCollect)
  @ApiOperation({ summary: 'My quotation rounds, quotes and receipt photos sent back for correction' })
  list(@CurrentUser() identity: RequestIdentity) {
    return this.service.list(identity);
  }
}
