import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { UnitOfMeasureLookupStatus } from '@erp/types';

export class ListUnitsOfMeasureQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: UnitOfMeasureLookupStatus;
}
