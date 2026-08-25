import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// ADR-019 CONST-PLC-006 — an authorized waiver of ONE specific failed WAIVABLE readiness condition.
// The override targets the condition by its code (e.g. PROGRAMME_DATES); there is no whole-command
// `force`. The reason is recorded on the audit event.
export class WaiverOverrideDto {
  @ApiProperty({ example: 'PROGRAMME_DATES', description: 'The readiness condition code being waived' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  condition!: string;

  @ApiProperty({ example: 'Dates confirmed verbally with the client; formal programme to follow' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
