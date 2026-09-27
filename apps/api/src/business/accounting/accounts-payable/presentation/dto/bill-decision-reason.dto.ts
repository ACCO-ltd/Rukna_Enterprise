import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body of POST /bills/:id/return and /bills/:id/reject — the reason is required. */
export class BillDecisionReasonDto {
  @ApiProperty({ description: 'Why the bill is returned or rejected. Shown to the clerk and kept in the audit trail.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
