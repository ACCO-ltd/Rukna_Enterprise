import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

// reject requires a reason (CONST-VAR-004). withdraw's reason is optional.
export class RejectVariationDto {
  @ApiProperty({ description: 'Reason for rejection (required).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class WithdrawVariationDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}

// variation-collapse — reverse (un-adopt) an adopted, unbilled variation. Optional reason, mirroring
// withdraw; it is recorded on the WITHDRAWN transition + the reverse audit event.
export class ReverseVariationDto {
  @ApiPropertyOptional({ description: 'Optional reason for reversing (un-adopting) the variation.' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
