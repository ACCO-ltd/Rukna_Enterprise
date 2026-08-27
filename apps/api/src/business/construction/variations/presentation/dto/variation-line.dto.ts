import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsInt, MaxLength } from 'class-validator';

// Add a line to a DRAFT VO (CONST-VAR-002). Quantity may be negative (omission).
export class AddVariationLineDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @ApiProperty({ description: 'May be negative to express an omission.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  quantity!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  unitRate!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsInt()
  @IsOptional()
  sortOrder?: number;
}

// Update an existing line on a DRAFT VO. All fields optional (partial update).
export class UpdateVariationLineDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'May be negative to express an omission.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  unitRate?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
