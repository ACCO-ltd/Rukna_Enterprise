import { IsString, IsOptional, IsInt, Min, Length, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A15 (D8): supplier master-data corrections. Every field is optional (a PATCH edits only
 * what changed); the service rejects an empty body. Deliberately absent: `code` (the supplier's
 * stable identity — not editable here) and `status` (kept for a dedicated activate/deactivate flow).
 */
export class UpdateSupplierDto {
  @ApiPropertyOptional({ example: 'Al-Rashid Trading' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '310122445500003' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxNumber?: string;

  @ApiPropertyOptional({ example: 'SAR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ example: 'King Fahd Rd, Riyadh' })
  @IsOptional()
  @IsString()
  address?: string;
}
