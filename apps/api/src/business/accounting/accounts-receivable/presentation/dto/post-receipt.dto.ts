import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString, IsString, IsNotEmpty, IsArray, IsOptional,
  IsNumber, Min, ValidateNested, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiptAllocationDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  clientInvoiceId!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0.01)
  amount!: number;
}

export class PostReceiptDto {
  @ApiPropertyOptional({ description: 'The registered bank account the money landed in (active, taking receipts). Give this or bankAccountCode.' })
  @IsString() @IsOptional() @IsNotEmpty()
  bankAccountId?: string;

  @ApiPropertyOptional({ example: 'BNK-001', description: 'The GL code of a registered bank account, instead of bankAccountId' })
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(30)
  bankAccountCode?: string;

  @ApiPropertyOptional({ example: '2026-11-15', description: 'PM-4: the day a cheque on hand is deposited (today when omitted); not before the cheque date' })
  @IsOptional() @IsDateString()
  depositDate?: string;

  @ApiPropertyOptional({ example: 'AR-001', description: 'Override for the AR control account (resolved by role when omitted)' })
  @IsString() @IsOptional() @MaxLength(30)
  arAccountCode?: string;

  @ApiPropertyOptional({ example: 'UNP-001', description: 'Override for the unapplied-receipts account (resolved by role when omitted)' })
  @IsString() @IsOptional() @MaxLength(30)
  unappliedAccountCode?: string;

  @ApiPropertyOptional({ type: [ReceiptAllocationDto], description: 'Allocate at post time — unallocated goes to Unapplied' })
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => ReceiptAllocationDto)
  allocations?: ReceiptAllocationDto[];
}
