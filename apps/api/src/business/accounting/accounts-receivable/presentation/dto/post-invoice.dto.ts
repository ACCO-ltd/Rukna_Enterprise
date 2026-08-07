import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class PostInvoiceDto {
  @ApiProperty({ example: 'AR-001', description: 'AR GL control account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  arAccountCode!: string;

  @ApiProperty({ example: 'REV-001', description: 'Revenue GL account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  revenueAccountCode!: string;

  @ApiPropertyOptional({ example: 'VAT-OUT-001', description: 'Output VAT GL account code (required if invoice has VAT)' })
  @IsString() @IsOptional() @MaxLength(30)
  vatAccountCode?: string;
}
