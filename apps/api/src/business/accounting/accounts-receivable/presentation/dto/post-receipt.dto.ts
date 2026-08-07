import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsArray, IsOptional,
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
  @ApiProperty({ example: 'BNK-001', description: 'Bank GL account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  bankAccountCode!: string;

  @ApiProperty({ example: 'AR-001', description: 'AR GL control account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  arAccountCode!: string;

  @ApiProperty({ example: 'UNP-001', description: 'Unapplied receipts GL account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  unappliedAccountCode!: string;

  @ApiPropertyOptional({ type: [ReceiptAllocationDto], description: 'Allocate at post time — unallocated goes to Unapplied' })
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => ReceiptAllocationDto)
  allocations?: ReceiptAllocationDto[];
}
