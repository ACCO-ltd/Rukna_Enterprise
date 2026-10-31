import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';

// ADR-024 ACC-POST-001: account codes are optional overrides. When omitted the server resolves
// the AR control and revenue accounts by role from the chart of accounts.
export class PostInvoiceDto {
  @ApiPropertyOptional({ example: 'AR-001', description: 'Override for the AR GL control account (resolved by role when omitted)' })
  @IsString() @IsOptional() @MaxLength(30)
  arAccountCode?: string;

  @ApiPropertyOptional({ example: 'REV-001', description: 'Override for the Revenue GL account (resolved by role when omitted)' })
  @IsString() @IsOptional() @MaxLength(30)
  revenueAccountCode?: string;
}
