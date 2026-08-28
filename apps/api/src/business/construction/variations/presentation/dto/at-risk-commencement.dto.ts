import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  MaxLength,
} from 'class-validator';

/**
 * ADR-026 CONST-VAR-011 (Variations Phase 5, Route 7B) — record an at-risk commencement authorisation
 * on a VariationOrder. Never an informal verbal instruction (memo Q7B): this payload IS the audited
 * authorisation. The Construction Director + CFO always authorise jointly; the CEO must additionally
 * authorise when the exposure exceeds the config-driven cap (default USD 25,000). The service enforces
 * that the required signatories are present and that they carry the matching roles — the client cannot
 * self-declare authority. It changes NEITHER contract value NOR the BOQ.
 */
export class RecordAtRiskCommencementDto {
  @ApiProperty({
    description:
      'The exposure ACCO accepts by starting early (in the contract currency). Non-negative. Drives whether the CEO step is required (above the cap).',
    example: 18000,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  exposureAmount!: number;

  @ApiPropertyOptional({
    description: 'ISO currency of the exposure. Defaults to the contract currency when omitted.',
    example: 'USD',
  })
  @IsString()
  @IsOptional()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ description: 'Why the work must start before the VO is finalised (required).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ description: 'The Construction Director authorising the at-risk start (user id).' })
  @IsString()
  @IsNotEmpty()
  constructionDirectorUserId!: string;

  @ApiProperty({ description: 'The CFO authorising the at-risk start (user id).' })
  @IsString()
  @IsNotEmpty()
  cfoUserId!: string;

  @ApiPropertyOptional({
    description:
      'The CEO authorising the at-risk start (user id). REQUIRED when the exposure exceeds the cap; rejected when it does not.',
  })
  @IsString()
  @IsOptional()
  ceoUserId?: string;
}
