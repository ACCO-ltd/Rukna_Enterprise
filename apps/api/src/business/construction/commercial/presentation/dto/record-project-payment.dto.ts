import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AllocationLineDto {
  @ApiProperty({ description: 'Client invoice ID to allocate against' })
  @IsString()
  @IsNotEmpty()
  clientInvoiceId!: string;

  @ApiProperty({
    example: 40000,
    description: 'Amount to allocate to this invoice (positive number, ≤ invoice outstanding)',
  })
  @IsNumber()
  @IsPositive()
  amount!: number;
}

/**
 * Slice 5B — record a project-level customer payment.
 *
 * The allocations array is the exact set the user confirmed in the drawer — never
 * auto-recomputed server-side.  An empty array creates a fully unapplied receipt.
 */
export class RecordProjectPaymentDto {
  @ApiProperty({ description: 'BankAccount ID where the payment was received' })
  @IsString()
  @IsNotEmpty()
  bankAccountId!: string;

  @ApiProperty({ example: '2026-09-17', description: 'Receipt date (ISO 8601 date string)' })
  @IsDateString()
  receiptDate!: string;

  @ApiProperty({ example: '60000.00', description: 'Total received amount (decimal string)' })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ example: 'SAR', description: 'ISO 4217 currency code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency!: string;

  @ApiPropertyOptional({ example: 'BANK_TRANSFER' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 'CHQ-00123' })
  @IsString()
  @IsOptional()
  reference?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    type: [AllocationLineDto],
    description:
      'Explicit allocation lines the user confirmed in the UI. ' +
      'Pass [] for a fully unapplied receipt. Never auto-computed server-side.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationLineDto)
  allocations!: AllocationLineDto[];

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key. If a receipt with this key already exists the ' +
      'existing record is returned without creating a duplicate — safe for network retries.',
  })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
