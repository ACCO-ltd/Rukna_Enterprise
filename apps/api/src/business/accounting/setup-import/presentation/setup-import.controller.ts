import { Body, Controller, HttpCode, Param, ParseEnumPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity, type SetupImportKind } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { SetupImportService } from '../application/setup-import.service.js';
import { SetupImportRequestDto } from './setup-import.dto.js';

const KIND_PIPE = new ParseEnumPipe({ suppliers: 'suppliers', clients: 'clients' });

/**
 * Step 5 — import suppliers or clients from a spreadsheet. The route admits whoever adds suppliers
 * or clients; the service applies the per-kind rule, and opening balances need Manage accounting.
 */
@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequireAnyPermission(PERMISSIONS.payablesManage, PERMISSIONS.clientsCreate, PERMISSIONS.receivablesManage)
@Controller('finance/import/:kind')
export class SetupImportController {
  constructor(private readonly service: SetupImportService) {}

  @Post('check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check mapped rows and say what an import would do; saves nothing' })
  check(
    @CurrentUser() identity: RequestIdentity,
    @Param('kind', KIND_PIPE) kind: SetupImportKind,
    @Body() dto: SetupImportRequestDto,
  ) {
    return this.service.check(identity, kind, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Import the rows, with their opening balances, in one transaction' })
  import(
    @CurrentUser() identity: RequestIdentity,
    @Param('kind', KIND_PIPE) kind: SetupImportKind,
    @Body() dto: SetupImportRequestDto,
  ) {
    return this.service.import(identity, kind, dto);
  }
}
