import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsArray,
  ArrayUnique,
  MaxLength,
} from 'class-validator';

/**
 * ADR-026 CONST-VAR-009 (Variations Phase 4) — the Extension-of-Time command payload.
 *
 * The new contractual completion date (`newEndDate`) is the supplied EFFECTIVE date (accounting-date
 * rule: it is used as-is, never `new Date()`). A `reason` is mandatory — moving the completion date is
 * a significant, audited act. `variationOrderIds` optionally cites VOs on this contract as
 * justification; a cited VO is justification the actor read, never the cause of the change.
 */
export class GrantExtensionOfTimeDto {
  @ApiProperty({
    description: 'The new contractual completion date (ISO-8601). Used as the effective date as-is.',
    example: '2027-03-31',
  })
  @IsDateString()
  @IsNotEmpty()
  newEndDate!: string;

  @ApiProperty({ description: 'Why the completion date is being moved (required, audited).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Optional VariationOrder ids on this contract cited as justification.',
    type: [String],
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  variationOrderIds?: string[];
}
