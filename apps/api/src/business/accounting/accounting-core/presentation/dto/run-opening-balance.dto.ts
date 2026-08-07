import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsDateString, IsArray, IsOptional,
  ValidateNested, IsNumber, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TrialBalanceLineDto {
  @ApiProperty({ example: '1100' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  accountCode!: string;

  @ApiPropertyOptional({ example: 50000 })
  @IsNumber() @IsOptional()
  debitBalance?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber() @IsOptional()
  creditBalance?: number;
}

export class OpenArInvoiceDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ example: 'INV-2024-001' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  invoiceRef!: string;

  @ApiProperty({ example: '2024-12-01' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: '2025-01-31' })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  subtotal!: number;

  @ApiProperty({ example: 500 })
  @IsNumber()
  vatAmount!: number;

  @ApiProperty({ example: 10500 })
  @IsNumber()
  totalAmount!: number;
}

export class OpenApBillDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  supplierId!: string;

  @ApiProperty({ example: 'SUPP-INV-001' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  supplierInvoiceNumber!: string;

  @ApiProperty({ example: '2024-11-15' })
  @IsDateString()
  billDate!: string;

  @ApiProperty({ example: '2025-01-15' })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  subtotal!: number;

  @ApiProperty({ example: 250 })
  @IsNumber()
  vatAmount!: number;

  @ApiProperty({ example: 5250 })
  @IsNumber()
  totalAmount!: number;

  @ApiProperty({ example: 'GENERAL-EXPENSE' })
  @IsString() @IsNotEmpty()
  expenseProfileCode!: string;
}

export class RunOpeningBalanceDto {
  @ApiProperty({ example: '2025-01-01', description: 'Cutover date — first day of live operations' })
  @IsDateString()
  cutoverDate!: string;

  @ApiProperty({ example: 'OB-2025-BATCH-01' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  batchReference!: string;

  @ApiProperty({ example: 'AR-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  arAccountCode!: string;

  @ApiProperty({ example: 'AP-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode!: string;

  @ApiProperty({ type: [TrialBalanceLineDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => TrialBalanceLineDto)
  trialBalance!: TrialBalanceLineDto[];

  @ApiPropertyOptional({ type: [OpenArInvoiceDto] })
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => OpenArInvoiceDto)
  openArInvoices?: OpenArInvoiceDto[];

  @ApiPropertyOptional({ type: [OpenApBillDto] })
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => OpenApBillDto)
  openApBills?: OpenApBillDto[];
}
