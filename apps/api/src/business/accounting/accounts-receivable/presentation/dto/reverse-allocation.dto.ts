import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, IsOptional } from 'class-validator';

export class ReverseAllocationDto {
  @ApiPropertyOptional({ example: 'AR-001', description: 'Override for the AR control account (resolved by role when omitted)' })
  @IsString() @IsOptional() @MaxLength(30)
  arAccountCode?: string;

  @ApiPropertyOptional({ example: 'UNP-001', description: 'Override for the unapplied-receipts account (resolved by role when omitted)' })
  @IsString() @IsOptional() @MaxLength(30)
  unappliedAccountCode?: string;
}
