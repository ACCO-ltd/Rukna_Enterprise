import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

/**
 * ADR-026 CONST-VAR-007 / OQ-2 (Variations Phase 2) — the adopt-baseline (Contract-Baseline repoint)
 * payload. OQ-2 makes this a deliberate, recorded, audited act: the target baselined version is
 * required, and a reason is captured on the audit record.
 */
export class AdoptBaselineDto {
  @ApiProperty({ description: 'The BASELINED BOQ version to adopt as the Contract Baseline.' })
  @IsString()
  @IsNotEmpty()
  boqVersionId!: string;

  @ApiPropertyOptional({ description: 'Why the baseline is being repointed (recorded on the audit event).' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
