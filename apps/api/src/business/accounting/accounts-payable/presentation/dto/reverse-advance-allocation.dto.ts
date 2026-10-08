import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReverseAdvanceAllocationDto {
  @ApiPropertyOptional({ example: 'AP-001' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode?: string;

  @ApiPropertyOptional({ example: 'ADV-001' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  supplierAdvanceCode?: string;
}
