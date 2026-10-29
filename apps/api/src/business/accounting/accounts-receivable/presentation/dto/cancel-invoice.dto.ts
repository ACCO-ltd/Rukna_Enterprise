import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelInvoiceDto {
  @ApiPropertyOptional({ example: 'Raised for the wrong client' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
