import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty, IsNumber, Min, MaxLength } from 'class-validator';

export class AllocateAdvanceDto {
  @ApiProperty({ description: 'Supplier bill ID to apply the advance against' })
  @IsString() @IsNotEmpty()
  supplierBillId!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ example: 'AP-001' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode?: string;

  @ApiPropertyOptional({ example: 'ADV-001' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  supplierAdvanceCode?: string;
}
