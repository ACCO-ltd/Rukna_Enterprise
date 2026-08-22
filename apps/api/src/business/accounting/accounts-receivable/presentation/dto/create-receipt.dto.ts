import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsDecimal, IsDateString, IsOptional, IsNotEmpty, MaxLength } from 'class-validator';

// ACC-SET-001 BE-2: moved here from the retired finance module. Records a client receipt
// (NOT_POSTED until it is posted to the GL via /customer-receipts/:id/post).
export class CreateReceiptDto {
  @ApiProperty({ description: 'Client ID who made the payment' })
  @IsString() @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ example: '2026-06-15' })
  @IsDateString()
  receiptDate!: string;

  @ApiProperty({ example: '125000.00' })
  @IsDecimal()
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @MaxLength(3)
  currency!: string;

  @ApiPropertyOptional({ description: 'Bank reference or payment advice number' })
  @IsString() @MaxLength(100) @IsOptional()
  reference?: string;

  @ApiPropertyOptional()
  @IsString() @MaxLength(500) @IsOptional()
  notes?: string;
}
