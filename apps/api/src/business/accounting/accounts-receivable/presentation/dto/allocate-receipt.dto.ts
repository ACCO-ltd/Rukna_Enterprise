import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min, MaxLength, IsOptional } from 'class-validator';

export class AllocateReceiptDto {
  @ApiProperty({ description: 'Client invoice ID to allocate against' })
  @IsString() @IsNotEmpty()
  clientInvoiceId!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ example: 'AR-001', description: 'Override for the AR control account (resolved by role when omitted)' })
  @IsString() @IsOptional() @MaxLength(30)
  arAccountCode?: string;

  @ApiPropertyOptional({ example: 'UNP-001', description: 'Override for the unapplied-receipts account (resolved by role when omitted)' })
  @IsString() @IsOptional() @MaxLength(30)
  unappliedAccountCode?: string;
}
