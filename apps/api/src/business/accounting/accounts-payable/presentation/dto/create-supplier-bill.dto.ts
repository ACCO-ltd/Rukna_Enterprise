import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsDateString, IsArray, IsOptional,
  IsNumber, Min, ValidateNested, ArrayMinSize, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSupplierBillLineDto {
  @ApiProperty({ example: 'Scaffolding hire — January 2025' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ example: 10 })
  @IsNumber() @Min(0) @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsNumber() @Min(0) @IsOptional()
  unitPrice?: number;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0)
  netAmount!: number;

  @ApiProperty({ example: 250 })
  @IsNumber() @Min(0)
  vatAmount!: number;

  @ApiProperty({ example: 'GENERAL-EXPENSE', description: 'Expense posting profile code' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  expenseProfileCode!: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  projectId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  boqNodeId?: string;
}

export class CreateSupplierBillDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  supplierId!: string;

  @ApiProperty({ example: 'SUPP-INV-2025-001' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  supplierInvoiceNumber!: string;

  @ApiProperty({ example: '2025-01-15' })
  @IsDateString()
  billDate!: string;

  @ApiProperty({ example: '2025-02-14' })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;


  @ApiPropertyOptional()
  @IsString() @IsOptional()
  purchaseOrderId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  projectId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  departmentId?: string;

  @ApiProperty({ type: [CreateSupplierBillLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateSupplierBillLineDto)
  lines!: CreateSupplierBillLineDto[];
}
