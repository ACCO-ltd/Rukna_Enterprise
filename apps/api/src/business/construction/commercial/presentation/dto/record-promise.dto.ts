import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Recording a payment promise. Deliberately has NO dueDate field — a promise must never
 * overwrite the invoice contractual due date. Enforced structurally here.
 */
export class RecordPromiseDto {
  @ApiProperty({ description: 'YYYY-MM-DD date the client committed to pay' })
  @IsDateString()
  promisedDate!: string;

  @ApiPropertyOptional({ description: 'Optional committed amount (decimal string). Null = full outstanding.' })
  @IsOptional()
  @IsString()
  promisedAmount?: string;

  @ApiPropertyOptional({ description: 'Optional note' })
  @IsOptional()
  @IsString()
  note?: string;
}
