import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min, IsDateString, IsOptional, MaxLength } from 'class-validator';

export class CreatePurchaseAllocationDto {
  @ApiProperty({ description: 'Purchase order ID to link this payment to' })
  @IsString() @IsNotEmpty()
  purchaseOrderId!: string;

  @ApiProperty({ example: 5000, description: 'Amount allocated from this payment toward the PO' })
  @IsNumber() @Min(0.01)
  allocatedAmount!: number;

  @ApiProperty({ example: '2025-03-01', description: 'ISO date of the allocation' })
  @IsDateString()
  allocationDate!: string;

  @ApiPropertyOptional({ example: 'Pre-funding for materials delivery', maxLength: 500 })
  @IsString() @IsOptional() @MaxLength(500)
  notes?: string;
}
