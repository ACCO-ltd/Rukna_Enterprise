import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreatePostingProfileDto {
  @ApiProperty({ example: 'COST_51100', description: 'A–Z, 0–9 and _ only (max 50)' })
  @IsString() @Matches(/^[A-Z0-9_]{1,50}$/)
  code!: string;

  @ApiProperty({ example: 'Cement and concrete' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  name!: string;

  @ApiProperty({ example: '51100', description: 'An ACTIVE posting account in INCOME / COST_OF_SALES / EXPENSE' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  accountCode!: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Defaults to today' })
  @IsOptional() @IsISO8601()
  effectiveFrom?: string;
}

export class RepointPostingProfileDto {
  @ApiPropertyOptional({ description: 'New display name; defaults to the current one' })
  @IsOptional() @IsString() @MaxLength(255)
  name?: string;

  @ApiProperty({ example: '51200' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  accountCode!: string;

  @ApiProperty({ example: '2026-10-01', description: 'Must be after the current version starts' })
  @IsISO8601()
  effectiveFrom!: string;
}
