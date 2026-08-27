import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, MaxLength } from 'class-validator';

// Header edit while DRAFT (CONST-VAR-004). Line CRUD is separate.
export class UpdateVariationDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Proposed only (CONST-VAR-003). Pass null to clear.' })
  @IsInt()
  @IsOptional()
  proposedTimeImpactDays?: number | null;
}
