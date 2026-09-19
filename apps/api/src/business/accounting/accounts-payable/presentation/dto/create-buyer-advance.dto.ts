import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsNumber, Min, IsDateString,
  IsOptional, MaxLength, IsEnum,
} from 'class-validator';

export enum BuyerAdvancePaymentMethodDto {
  BANK = 'BANK',
  MOBILE_MONEY = 'MOBILE_MONEY',
}

export class CreateBuyerAdvanceDto {
  @ApiProperty({ description: 'Purchase order this advance is associated with' })
  @IsString() @IsNotEmpty()
  purchaseOrderId!: string;

  @ApiProperty({ description: 'User ID of the employee receiving the advance' })
  @IsString() @IsNotEmpty()
  recipientUserId!: string;

  @ApiProperty({ example: 2500, description: 'Advance amount' })
  @IsNumber() @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'USD', maxLength: 3 })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ enum: BuyerAdvancePaymentMethodDto, description: 'Disbursement method (BANK or MOBILE_MONEY)' })
  @IsEnum(BuyerAdvancePaymentMethodDto)
  paymentMethod!: BuyerAdvancePaymentMethodDto;

  @ApiProperty({ description: 'Bank account ID used for disbursement' })
  @IsString() @IsNotEmpty()
  disbursementBankAccountId!: string;

  @ApiPropertyOptional({ example: 'ADV-2025-001', maxLength: 100 })
  @IsString() @IsOptional() @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString() @IsOptional() @MaxLength(500)
  notes?: string;

  @ApiProperty({ example: '2025-03-01', description: 'ISO date the advance was disbursed' })
  @IsDateString()
  advancedAt!: string;
}
