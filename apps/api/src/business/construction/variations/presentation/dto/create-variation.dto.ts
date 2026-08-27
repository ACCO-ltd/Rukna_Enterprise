import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  MaxLength,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

// A single free-text variation line (CONST-VAR-002). Quantity may be negative for an omission.
export class VariationLineDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @ApiProperty({ description: 'May be negative to express an omission (CONST-VAR-002).' })
  @IsNumber({ maxDecimalPlaces: 4 })
  quantity!: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  unitRate!: number;
}

export class CreateVariationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Proposed only (CONST-VAR-003); never moves the date automatically.' })
  @IsInt()
  @IsOptional()
  proposedTimeImpactDays?: number;

  @ApiPropertyOptional({ type: [VariationLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariationLineDto)
  @IsOptional()
  lines?: VariationLineDto[];
}
