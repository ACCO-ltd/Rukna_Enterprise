import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

/**
 * ADR-026 CONST-VAR-004 / OQ-4 (provisional) — the client-approval evidence payload.
 *
 * OQ-4 is still open (what constitutes "client + contractual approval", and whether this transition
 * is itself governed). Provisional shape: require a `clientApprovalReference` (signed VO number /
 * client letter reference) plus an optional note. See the TODO(OQ-4) in the service.
 */
export class ClientApproveVariationDto {
  @ApiProperty({ description: 'Client/contractual approval reference (signed VO no. or letter ref).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clientApprovalReference!: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  note?: string;
}

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
