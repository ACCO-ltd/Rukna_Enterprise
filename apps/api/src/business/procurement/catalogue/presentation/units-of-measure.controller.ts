import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { RequestIdentity } from '@erp/types';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { UomService } from '../application/uom.service.js';
import { ListUnitsOfMeasureQueryDto } from './dto/list-units-of-measure.query.dto.js';

/**
 * The unit registry as a read-only lookup, for any signed-in member of the organization.
 *
 * Why a second route rather than relaxing `GET /procurement/uom`: that controller is the
 * registry's management surface and carries `manage:procurement-config` at class level for all
 * four of its routes. The BOQ unit picker (and any other screen that picks a unit) needs to read
 * the registry without being allowed to administer it. A separate, deliberately narrow route —
 * the `{ code, name, symbol }` projection, no ids, no writes — keeps the management permission
 * exactly as it was and makes the open read visible as a decision rather than a method-level
 * exception buried in a gated controller. Same pattern as `GET /districts`: reference data
 * readable by the people who need to pick from it, writes gated.
 *
 * No `@RequirePermissions`: authentication (JwtAuthGuard) and org scoping (the service reads the
 * caller's active organization) are the whole of its access rule.
 */
@ApiTags('Units of Measure')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('units-of-measure')
export class UnitsOfMeasureController {
  constructor(private readonly service: UomService) {}

  @Get()
  @ApiOperation({ summary: 'List units of measure (code, name, symbol) for pickers. Defaults to ACTIVE.' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE'] })
  list(@CurrentUser() identity: RequestIdentity, @Query() query: ListUnitsOfMeasureQueryDto) {
    return this.service.listLookup(identity, query.status ?? 'ACTIVE');
  }
}
