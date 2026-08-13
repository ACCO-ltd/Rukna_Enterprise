import { IsString, IsOptional, IsDateString, IsNumber, Length, MaxLength, Min, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommercialModel, ParticipationModel } from '@prisma/client';

export class CreateProjectDto {
  @ApiPropertyOptional({
    example: 'ACCO-2026-001',
    maxLength: 30,
    deprecated: true,
    description: 'Legacy compatibility only. Omit to receive an automatically assigned project code.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  code?: string;

  @ApiProperty({ example: 'Al-Baraka Tower Construction' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'مشروع برج البركة' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameAr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Baraka Real Estate LLC' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientName?: string;

  @ApiPropertyOptional({ description: 'Client selected from the organization client registry' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ enum: CommercialModel, default: CommercialModel.CLIENT_CONTRACT })
  @IsOptional()
  @IsEnum(CommercialModel)
  commercialModel?: CommercialModel;

  @ApiPropertyOptional({ enum: ParticipationModel, default: ParticipationModel.SOLE })
  @IsOptional()
  @IsEnum(ParticipationModel)
  participationModel?: ParticipationModel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({ example: 4500000.0, description: 'Contract value (set when approved)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  contractValue?: number;

  @ApiPropertyOptional({ example: 'USD', maxLength: 3 })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2028-03-31' })
  @IsOptional()
  @IsDateString()
  expectedEndDate?: string;
}
