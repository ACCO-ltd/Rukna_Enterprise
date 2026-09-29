import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { UomService } from '../application/uom.service.js';
import { ListUnitsOfMeasureQueryDto } from './dto/list-units-of-measure.query.dto.js';

/**
 * The unit registry as a read-only lookup, for anyone who can view projects.
 *
 * Why a second route rather than relaxing `GET /procurement/uom`: that controller is the
 * registry's management surface and carries `manage:procurement-config` at class level for all
 * four of its routes. The BOQ unit picker (and any other screen that picks a unit) needs to read
 * the registry without being allowed to administer it. A separate, deliberately narrow route —
 * the `{ code, name, symbol }` projection, no ids, no writes — keeps the management permission
 * exactly as it was and makes the read an explicit decision rather than a method-level exception
 * buried in a gated controller.
 *
 * Gated on `view:project`, the same as `GET /districts`: reference data readable by the people
 * who pick from it. Every role that can edit a BOQ holds it — the seeded Construction Director,
 * Project Manager and Site Engineer all do (acco-team-roles.seed.ts), and the BOQ routes
 * themselves need `view:boq` plus project access on top. Scoped to the caller's active
 * organization by the service.
 */
@RequirePermissions(PERMISSIONS.projectsView)
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
