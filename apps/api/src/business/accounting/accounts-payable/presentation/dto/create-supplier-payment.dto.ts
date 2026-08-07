import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsDateString, IsArray, IsOptional,
  IsNumber, Min, ValidateNested, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PaymentAllocationDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  supplierBillId!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0.01)
  amount!: number;
}

export class CreateSupplierPaymentDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  supplierId!: string;

  @ApiProperty({ description: 'Bank account ID to pay from' })
  @IsString() @IsNotEmpty()
  bankAccountId!: string;

  @ApiProperty({ example: '2025-01-20' })
  @IsDateString()
  paymentDate!: string;

  @ApiPropertyOptional({ example: '2025-01-20', description: 'Defaults to paymentDate if omitted' })
  @IsDateString() @IsOptional()
  accountingDate?: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ example: 1.0 })
  @IsNumber() @IsOptional()
  exchangeRateSnapshot?: number;

  @ApiProperty({ example: 10000 })
  @IsNumber() @Min(0.01)
  totalAmount!: number;

  @ApiProperty({ example: 'BANK_TRANSFER' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  paymentMethod!: string;

  @ApiPropertyOptional({ example: 'TRF-2025-001' })
  @IsString() @IsOptional() @MaxLength(100)
  bankReference?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional() @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ type: [PaymentAllocationDto], description: 'Allocate against bills at payment time' })
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
}
