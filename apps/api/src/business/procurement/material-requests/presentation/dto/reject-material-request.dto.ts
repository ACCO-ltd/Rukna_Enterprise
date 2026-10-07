import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** Send a SUBMITTED material request back to the requester (→ DRAFT). */
export class RejectMaterialRequestDto {
  @ApiProperty({ description: 'Why the request is sent back — shown on the audit trail' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
